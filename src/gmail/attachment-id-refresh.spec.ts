import { NotFoundException, BadGatewayException } from '@nestjs/common';
import { google } from 'googleapis';
import { GmailService } from './gmail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessageStateService } from '../communications/message-state.service';

/**
 * Re-resolving a superseded Gmail attachmentId.
 *
 * Gmail mints a FRESH `attachmentId` on every `threads.get`. The client used to rebuild
 * every attachment URL from it on each 15s poll, which changed the `<img src>` and made
 * open attachments blink; it now freezes the first URL it built for a file. That trade
 * is only safe because of this path: a frozen id eventually goes stale, so a 404 here is
 * EXPECTED, and the service re-reads the message and retries with the current id.
 *
 * Without the retry the fix would have swapped a blink for a broken image.
 */
describe('getEmailAttachment — stale attachmentId', () => {
  const COMPANY = 42;
  const MESSAGE = 'msg-1';
  const FILE = { filename: 'invoice.pdf', size: 1234 };

  const BYTES = Buffer.from('hello').toString('base64url');

  let svc: GmailService;
  let attachmentsGet: jest.Mock;
  let messagesGet: jest.Mock;
  let warn: jest.SpyInstance;

  /** googleapis reports a missing attachment as a GaxiosError with `code`. */
  const gone = (code: number) =>
    Object.assign(new Error('Not Found'), { code });

  /** A Gmail payload holding one real attachment part. */
  const payloadWith = (attachmentId: string) => ({
    parts: [
      {
        filename: FILE.filename,
        mimeType: 'application/pdf',
        headers: [],
        body: { size: FILE.size, attachmentId },
      },
    ],
  });

  beforeEach(() => {
    attachmentsGet = jest.fn();
    messagesGet = jest.fn();
    jest.spyOn(google, 'gmail').mockReturnValue({
      users: {
        messages: {
          get: messagesGet,
          attachments: { get: attachmentsGet },
        },
      },
    } as unknown as ReturnType<typeof google.gmail>);

    svc = new GmailService({} as PrismaService, {} as MessageStateService);
    // Tokens are not what these tests are about.
    (
      svc as unknown as { ensureFreshTokens: () => Promise<unknown> }
    ).ensureFreshTokens = jest.fn().mockResolvedValue({});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
    jest.restoreAllMocks();
  });

  it('costs no extra call when the id is still current', async () => {
    attachmentsGet.mockResolvedValue({ data: { data: BYTES } });

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'fresh-id', FILE),
    ).resolves.toEqual(Buffer.from('hello'));

    expect(attachmentsGet).toHaveBeenCalledTimes(1);
    expect(messagesGet).not.toHaveBeenCalled(); // the happy path must stay one request
  });

  it('re-reads the message and retries once on a 404', async () => {
    attachmentsGet
      .mockRejectedValueOnce(gone(404))
      .mockResolvedValueOnce({ data: { data: BYTES } });
    messagesGet.mockResolvedValue({
      data: { payload: payloadWith('current-id') },
    });

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id', FILE),
    ).resolves.toEqual(Buffer.from('hello'));

    expect(attachmentsGet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'current-id' }),
    );
  });

  it('also retries on a 410', async () => {
    attachmentsGet
      .mockRejectedValueOnce(gone(410))
      .mockResolvedValueOnce({ data: { data: BYTES } });
    messagesGet.mockResolvedValue({
      data: { payload: payloadWith('current-id') },
    });

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id', FILE),
    ).resolves.toEqual(Buffer.from('hello'));
  });

  it('matches on filename when the reported size has drifted', async () => {
    attachmentsGet
      .mockRejectedValueOnce(gone(404))
      .mockResolvedValueOnce({ data: { data: BYTES } });
    messagesGet.mockResolvedValue({
      data: {
        payload: {
          parts: [
            {
              filename: FILE.filename,
              mimeType: 'application/pdf',
              headers: [],
              body: { size: FILE.size + 9, attachmentId: 'current-id' },
            },
          ],
        },
      },
    });

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id', FILE),
    ).resolves.toEqual(Buffer.from('hello'));
    expect(attachmentsGet).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: 'current-id' }),
    );
  });

  it('does not retry when the re-read finds the same id', async () => {
    attachmentsGet.mockRejectedValue(gone(404));
    messagesGet.mockResolvedValue({
      data: { payload: payloadWith('stale-id') },
    });

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id', FILE),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(attachmentsGet).toHaveBeenCalledTimes(1);
  });

  it('404s cleanly when the file is genuinely gone from the message', async () => {
    attachmentsGet.mockRejectedValue(gone(404));
    messagesGet.mockResolvedValue({ data: { payload: { parts: [] } } });

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id', FILE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('survives the re-read itself failing', async () => {
    attachmentsGet.mockRejectedValue(gone(404));
    messagesGet.mockRejectedValue(new Error('network'));

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id', FILE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never re-resolves a non-404 — a real outage must not read as a stale id', async () => {
    attachmentsGet.mockRejectedValue(gone(500));

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'some-id', FILE),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(messagesGet).not.toHaveBeenCalled();
  });

  it('skips the re-read when the caller passed no file identity', async () => {
    // Older client builds send a URL with no `size`; they degrade to the old behaviour
    // rather than erroring.
    attachmentsGet.mockRejectedValue(gone(404));

    await expect(
      svc.getEmailAttachment(COMPANY, MESSAGE, 'stale-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(messagesGet).not.toHaveBeenCalled();
  });
});
