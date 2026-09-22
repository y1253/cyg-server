import { NotFoundException } from '@nestjs/common';
import { Readable, Writable } from 'stream';
import type { Response } from 'express';
import { streamAttachmentStored } from '../communications/attachment-stream.util.js';

/**
 * The object-storage arm of the attachment read path.
 *
 * `attachment-stream.util.spec.ts` already pins the Range table against the in-memory
 * source. These assert the SAME answers come back when the bytes live in the bucket —
 * which is the point of computing them from `parseRange` here rather than delegating the
 * Range header to R2: a file that has been migrated and one that has not must behave
 * identically, or the rollout itself becomes the bug.
 */

/** 20 bytes, deliberately not round: an off-by-one is invisible on a tidy length. */
const BODY = Buffer.from('0123456789abcdefghij');

interface FakeRes {
  res: Response;
  headers: Record<string, string | number>;
  statusOf: () => number;
  body: () => Promise<Buffer>;
}

/**
 * A real `Writable` with the two Express methods bolted on.
 *
 * It has to be a genuine stream: `streamAttachmentStored` ends in `stream.pipe(res)`, and
 * a plain object fails with `dest.once is not a function` — which is how this spec first
 * failed six ways at once.
 */
function fakeRes(): FakeRes {
  const headers: Record<string, string | number> = {};
  const chunks: Buffer[] = [];
  let statusCode = 200;

  const res = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk as Buffer));
      cb();
    },
  }) as unknown as Response & Writable;

  res.setHeader = ((key: string, value: string | number) => {
    headers[key] = value;
    return res;
  }) as Response['setHeader'];

  res.status = ((code: number) => {
    statusCode = code;
    return res;
  }) as Response['status'];

  const body = () =>
    new Promise<Buffer>((resolve) => {
      if ((res as Writable).writableEnded) {
        resolve(Buffer.concat(chunks));
        return;
      }
      (res as Writable).on('finish', () => resolve(Buffer.concat(chunks)));
    });

  return { res, headers, statusOf: () => statusCode, body };
}

/** A storage double: `head` reports a size, `getStream` serves the requested slice. */
function fakeStorage(size: number | null = BODY.length) {
  return {
    head: jest.fn().mockResolvedValue(size === null ? null : { size }),
    getStream: jest
      .fn()
      .mockImplementation(
        (_key: string, range: { start: number; end: number } | null) =>
          Promise.resolve(
            Readable.from([
              range ? BODY.subarray(range.start, range.end + 1) : BODY,
            ]),
          ),
      ),
  };
}

describe('streamAttachmentStored — range semantics match the in-memory source', () => {
  it('serves the whole object with no Range header', async () => {
    const { res, headers, body } = fakeRes();
    const storage = fakeStorage();

    await streamAttachmentStored(
      res,
      storage,
      'messages/a.txt',
      'text/plain',
      'a.txt',
      'inline',
    );

    expect(headers['Content-Length']).toBe(20);
    expect(headers['Accept-Ranges']).toBe('bytes');
    expect(storage.getStream).toHaveBeenCalledWith('messages/a.txt', null);
    expect(await body()).toEqual(BODY);
  });

  it('answers a closed range with 206 and a Content-Range built from the total', async () => {
    const { res, headers, statusOf, body } = fakeRes();
    const storage = fakeStorage();

    await streamAttachmentStored(
      res,
      storage,
      'messages/a.txt',
      'text/plain',
      'a.txt',
      'inline',
      'bytes=5-9',
    );

    expect(statusOf()).toBe(206);
    expect(headers['Content-Range']).toBe('bytes 5-9/20');
    expect(headers['Content-Length']).toBe(5);
    expect(storage.getStream).toHaveBeenCalledWith('messages/a.txt', {
      start: 5,
      end: 9,
    });
    expect((await body()).toString()).toBe('56789');
  });

  // The MP4 moov-atom case: `bytes=-4` is the LAST four bytes, not the first four.
  it('reads a suffix range as the last N bytes', async () => {
    const { res, headers, body } = fakeRes();
    const storage = fakeStorage();

    await streamAttachmentStored(
      res,
      storage,
      'messages/a.txt',
      'text/plain',
      'a.txt',
      'inline',
      'bytes=-4',
    );

    expect(headers['Content-Range']).toBe('bytes 16-19/20');
    expect(storage.getStream).toHaveBeenCalledWith('messages/a.txt', {
      start: 16,
      end: 19,
    });
    expect((await body()).toString()).toBe('ghij');
  });

  it('416s an unsatisfiable range, and never asks storage for bytes', async () => {
    const { res, headers, statusOf } = fakeRes();
    const storage = fakeStorage();

    await streamAttachmentStored(
      res,
      storage,
      'messages/a.txt',
      'text/plain',
      'a.txt',
      'inline',
      'bytes=99-120',
    );

    expect(statusOf()).toBe(416);
    expect(headers['Content-Range']).toBe('bytes */20');
    expect(storage.getStream).not.toHaveBeenCalled();
  });

  // Deliberate: a multi-range request gets the full entity. R2 would answer it its own
  // way, which is exactly why the Range header is not passed through.
  it('serves the whole entity for a multi-range request', async () => {
    const { res, headers } = fakeRes();
    const storage = fakeStorage();

    await streamAttachmentStored(
      res,
      storage,
      'messages/a.txt',
      'text/plain',
      'a.txt',
      'inline',
      'bytes=0-1,4-5',
    );

    expect(headers['Content-Length']).toBe(20);
    expect(storage.getStream).toHaveBeenCalledWith('messages/a.txt', null);
  });
});

describe('the headers come from OUR metadata, not the bucket', () => {
  it('uses the DB mime type and the caller cache-control', async () => {
    const { res, headers } = fakeRes();

    await streamAttachmentStored(
      res,
      fakeStorage(),
      'signature-images/a.png',
      'image/png',
      'logo.png',
      'inline',
      undefined,
      'public, max-age=86400',
    );

    expect(headers['Content-Type']).toBe('image/png');
    expect(headers['Cache-Control']).toBe('public, max-age=86400');
  });

  it('defaults to private caching for every other caller', async () => {
    const { res, headers } = fakeRes();

    await streamAttachmentStored(
      res,
      fakeStorage(),
      'messages/a.txt',
      'text/plain',
      'a.txt',
      'inline',
    );

    expect(headers['Cache-Control']).toBe('private, max-age=3600');
  });
});

describe('the miss path', () => {
  // The rollout bridge: deployed code, migration not yet run.
  it('consults local disk when the object is absent and a path is given', async () => {
    const { res } = fakeRes();
    const storage = fakeStorage(null);

    // No such file either, so it surfaces as the file-path helper's own 404 — what
    // matters is that it went looking rather than 404ing straight away.
    await expect(
      streamAttachmentStored(
        res,
        storage,
        'messages/gone.txt',
        'text/plain',
        'a.txt',
        'inline',
        undefined,
        undefined,
        '/definitely/not/here.txt',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(storage.head).toHaveBeenCalled();
  });

  it('404s with no headers written when the object is absent and fallback is off', async () => {
    const { res, headers } = fakeRes();

    await expect(
      streamAttachmentStored(
        res,
        fakeStorage(null),
        'messages/gone.txt',
        'text/plain',
        'a.txt',
        'inline',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    // The clean-404-before-any-header guarantee `streamAttachmentFile`'s `stat` gives.
    expect(Object.keys(headers)).toHaveLength(0);
  });

  // A real fault is not a 404: it must not be silently swallowed when there is nothing
  // to fall back to.
  it('rethrows a storage fault when no fallback path is given', async () => {
    const { res } = fakeRes();
    const storage = fakeStorage();
    storage.head.mockRejectedValue(new Error('r2 down'));

    await expect(
      streamAttachmentStored(
        res,
        storage,
        'messages/a.txt',
        'text/plain',
        'a.txt',
        'inline',
      ),
    ).rejects.toThrow('r2 down');
  });
});
