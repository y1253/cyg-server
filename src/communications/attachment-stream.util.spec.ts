import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import type { Response } from 'express';
import { streamAttachment } from './attachment-stream.util';

/**
 * Range handling is shared by the Gmail, Outlook and internal-message attachment
 * routes, and internal attachments are now large enough (250 MB) that a browser
 * really does seek through them rather than fetching the whole thing. These cover
 * the parsing via the in-memory entry point; `streamAttachmentFile` runs the same
 * `parseRange` against a file's size.
 */

interface FakeResponse {
  statusCode: number | null;
  headers: Record<string, string | number>;
  body: Buffer | null;
  res: Response;
}

function fakeResponse(): FakeResponse {
  const state: FakeResponse = {
    statusCode: null,
    headers: {},
    body: null,
    res: null as unknown as Response,
  };
  state.res = {
    setHeader: (name: string, value: string | number) => {
      state.headers[name] = value;
    },
    status: (code: number) => {
      state.statusCode = code;
    },
    end: (chunk?: Buffer) => {
      state.body = chunk ?? null;
    },
  } as unknown as Response;
  return state;
}

const body = Buffer.from('0123456789'); // 10 bytes, each digit its own index

function send(range?: string) {
  const out = fakeResponse();
  streamAttachment(out.res, body, 'text/plain', 'f.txt', undefined, range);
  return out;
}

describe('streamAttachment ranges', () => {
  it('serves the whole entity when there is no Range header', () => {
    const out = send();
    expect(out.statusCode).toBeNull();
    expect(out.headers['Content-Length']).toBe(10);
    expect(out.body?.toString()).toBe('0123456789');
    expect(out.headers['Accept-Ranges']).toBe('bytes');
  });

  it('serves a closed range as 206', () => {
    const out = send('bytes=2-4');
    expect(out.statusCode).toBe(206);
    expect(out.body?.toString()).toBe('234');
    expect(out.headers['Content-Range']).toBe('bytes 2-4/10');
    expect(out.headers['Content-Length']).toBe(3);
  });

  it('serves an open-ended range to the end of the entity', () => {
    const out = send('bytes=7-');
    expect(out.statusCode).toBe(206);
    expect(out.body?.toString()).toBe('789');
    expect(out.headers['Content-Range']).toBe('bytes 7-9/10');
  });

  it('treats bytes=0- as a range covering everything', () => {
    const out = send('bytes=0-');
    expect(out.statusCode).toBe(206);
    expect(out.body?.toString()).toBe('0123456789');
  });

  it('reads bytes=-N as the LAST n bytes, not the first', () => {
    // The case media players use to fetch an MP4's trailing moov atom. Reading it
    // as `0-N` returns the file header instead and playback stalls.
    const out = send('bytes=-3');
    expect(out.statusCode).toBe(206);
    expect(out.body?.toString()).toBe('789');
    expect(out.headers['Content-Range']).toBe('bytes 7-9/10');
  });

  it('clamps a suffix range longer than the entity', () => {
    const out = send('bytes=-99');
    expect(out.statusCode).toBe(206);
    expect(out.body?.toString()).toBe('0123456789');
    expect(out.headers['Content-Range']).toBe('bytes 0-9/10');
  });

  it('clamps an end past the last byte', () => {
    const out = send('bytes=8-99');
    expect(out.statusCode).toBe(206);
    expect(out.body?.toString()).toBe('89');
    expect(out.headers['Content-Range']).toBe('bytes 8-9/10');
  });

  it('416s when the start is past the end of the entity', () => {
    const out = send('bytes=10-12');
    expect(out.statusCode).toBe(416);
    expect(out.headers['Content-Range']).toBe('bytes */10');
    expect(out.body).toBeNull();
  });

  it('416s on a zero-length suffix range', () => {
    const out = send('bytes=-0');
    expect(out.statusCode).toBe(416);
  });

  it('ignores a Range header it cannot parse and serves everything', () => {
    // Multi-range and non-byte units: RFC 7233 permits answering with the full
    // entity rather than 416.
    expect(send('bytes=0-1,4-5').statusCode).toBeNull();
    expect(send('items=0-1').statusCode).toBeNull();
    expect(send('bytes=-').statusCode).toBeNull();
  });

  it('sanitizes the mime type and filename into the headers', () => {
    const out = fakeResponse();
    streamAttachment(
      out.res,
      body,
      'not a mime',
      'in"valid\r\nname.txt',
      'attachment',
    );
    expect(out.headers['Content-Type']).toBe('application/octet-stream');
    expect(out.headers['Content-Disposition']).toBe(
      'attachment; filename="in_valid__name.txt"',
    );
  });
});

/**
 * Content-Disposition, against a REAL ServerResponse.
 *
 * The fake above accepts any header value, which is exactly how the production
 * bug shipped: a Hebrew screenshot name went straight into the header and Node
 * threw ERR_INVALID_CHAR, 500-ing every open and download. HTTP header values
 * are Latin-1, and only the real implementation enforces that — so these drive
 * http.ServerResponse and additionally assert the value is Latin-1 clean.
 */
describe('Content-Disposition filename encoding', () => {
  const body = Buffer.from('0123456789');

  function realResponse(): Response {
    const req = new IncomingMessage(new Socket());
    return new ServerResponse(req) as unknown as Response;
  }

  function dispositionFor(
    filename: string,
    disposition = 'attachment',
  ): string {
    const res = realResponse();
    streamAttachment(res, body, 'image/png', filename, disposition);
    return String(res.getHeader('Content-Disposition'));
  }

  // eslint-disable-next-line no-control-regex
  const LATIN1_ONLY = /^[\x00-\xFF]*$/;

  it('does not throw on a Hebrew filename, and emits RFC 2231', () => {
    const hebrew = 'צילום מסך 2026-08-20.png';
    let value = '';
    expect(() => {
      value = dispositionFor(hebrew);
    }).not.toThrow();

    // The ASCII fallback keeps the extension so the file opens correctly.
    expect(value).toContain('filename="attachment.png"');
    // ...and the real name rides in filename*, decoding back to the original.
    const encoded = /filename\*=UTF-8''(.+)$/.exec(value)![1];
    expect(decodeURIComponent(encoded)).toBe(hebrew);
  });

  // The assertion that actually fails on the old code. Without it, a fake
  // response would let a header full of Hebrew sail through the test.
  it('emits a header value Node can transmit', () => {
    expect(dispositionFor('צילום מסך.png')).toMatch(LATIN1_ONLY);
    expect(dispositionFor('发票.pdf')).toMatch(LATIN1_ONLY);
    expect(dispositionFor('reçu 🎉.png')).toMatch(LATIN1_ONLY);
  });

  it('leaves an ASCII filename exactly as it was before', () => {
    expect(dispositionFor('invoice.pdf')).toBe(
      'attachment; filename="invoice.pdf"',
    );
    expect(dispositionFor('invoice.pdf', 'inline')).toBe(
      'inline; filename="invoice.pdf"',
    );
  });

  it('survives a 255-char cap landing mid-surrogate-pair', () => {
    // sanitizeFilename slices to 255 chars; put an emoji astride the boundary so
    // the slice splits it. encodeURIComponent throws URIError on a lone
    // surrogate — which would be the same 500 wearing a different hat.
    const name = 'a'.repeat(254) + '🎉' + '.png';
    expect(() => dispositionFor(name)).not.toThrow();
    expect(dispositionFor(name)).toMatch(LATIN1_ONLY);
  });

  it('still strips quotes and CRLF that would break the quoted string', () => {
    const value = dispositionFor('in"valid\r\nname.txt');
    expect(value).toBe('attachment; filename="in_valid__name.txt"');
  });
});
