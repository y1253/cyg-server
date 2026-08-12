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
