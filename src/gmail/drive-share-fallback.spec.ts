import { HttpException } from '@nestjs/common';
import type { drive_v3 } from 'googleapis';
import { uploadAndShare } from './drive-upload';

/**
 * A large attachment is uploaded to the sender's Drive and linked. The upload itself
 * was fine; granting the link-holder permission was not. A Workspace that forbids
 * sharing outside the organisation 403s `type: 'anyone'`, and that 403 used to
 * propagate as a bare `Error` — so a file that had already uploaded successfully
 * reported "Internal server error" and the user had no idea what to change.
 *
 * `onedrive-upload.ts` already solved the same problem with a two-scope fallback;
 * this is the Drive half.
 */

/**
 * The arguments a mock was called with, typed.
 *
 * `jest.fn()` is `any`, so `mock.calls[0][0]` is an unchecked access the lint rules
 * reject. Mirrors `argsOf` in `internal-calls/internal-calls.service.spec.ts`.
 */
function argsOf<T extends unknown[]>(mock: jest.Mock, call = 0): T {
  return mock.mock.calls[call] as T;
}

/** The `type` of the permission requested on the nth permissions.create call. */
function shareTypeOf(mock: jest.Mock, call: number): string {
  const [arg] = argsOf<[{ requestBody: { type: string } }]>(mock, call);
  return arg.requestBody.type;
}

const FILE = {
  originalname: 'statement.pdf',
  mimetype: 'application/pdf',
  size: 42,
  path: __filename, // a real, readable file — createReadStream is called for real
};

const driveWith = (
  permissionsCreate: jest.Mock,
  webViewLink: string | null = 'https://drive.google.com/file/d/abc/view',
) =>
  ({
    files: {
      create: jest.fn().mockResolvedValue({ data: { id: 'abc', webViewLink } }),
      get: jest
        .fn()
        .mockResolvedValue({ data: { webViewLink: 'https://fallback/view' } }),
    },
    permissions: { create: permissionsCreate },
  }) as unknown as drive_v3.Drive;

describe('uploadAndShare — sharing fallback', () => {
  it('shares with anyone and does not try domain', async () => {
    const create = jest.fn().mockResolvedValue({});
    const link = await uploadAndShare(driveWith(create), 'folder', FILE);

    expect(link.url).toBe('https://drive.google.com/file/d/abc/view');
    expect(create).toHaveBeenCalledTimes(1);
    expect(shareTypeOf(create, 0)).toBe('anyone');
  });

  // The tenant blocks external sharing. A domain link is a real degradation (an
  // outside recipient hits a sign-in wall) but it beats losing the whole send.
  it('falls back to a domain link when anyone is refused', async () => {
    const create = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('shareOutNotPermitted'), {
          response: { status: 403 },
        }),
      )
      .mockResolvedValueOnce({});

    await expect(
      uploadAndShare(driveWith(create), 'folder', FILE),
    ).resolves.toMatchObject({ name: 'statement.pdf' });

    expect(create).toHaveBeenCalledTimes(2);
    expect(shareTypeOf(create, 1)).toBe('domain');
  });

  // When both are refused the send genuinely cannot go out — but it must say WHY.
  // An HttpException is what survives `translateSendError` unmodified; a plain Error
  // would be re-wrapped into the generic message and the cause lost again.
  it('throws an HttpException naming the cause when both are refused', async () => {
    const create = jest
      .fn()
      .mockRejectedValue(new Error('shareOutNotPermitted'));

    const err = await uploadAndShare(driveWith(create), 'folder', FILE).catch(
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).message).toContain('statement.pdf');
    expect((err as HttpException).message).toContain('shareOutNotPermitted');
    expect((err as HttpException).message).toMatch(/block link sharing/i);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('re-reads webViewLink when create returns none', async () => {
    const create = jest.fn().mockResolvedValue({});
    const link = await uploadAndShare(driveWith(create, null), 'folder', FILE);
    expect(link.url).toBe('https://fallback/view');
  });
});
