import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import { GmailService } from './gmail.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { MessageStateService } from '../communications/message-state.service';

/**
 * The retry around `users.messages.send` is the one change on this path that can make
 * things WORSE than the bug it fixes: a blind re-send after a 429 or a 5xx delivers
 * the same email to a client twice, and unlike a 500 the user never finds out.
 *
 * So the contract under test is not "does it retry" but "does it prove the message is
 * absent before re-sending". The Message-ID the send path mints for every message is
 * what makes that provable — see `sendEmailWithStagedFiles`.
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

const MSG_ID = '<abc-123@cygfinance.com>';
const COMPANY = 7;

interface Internals {
  sendWithRetry(
    companyId: number,
    gmail: unknown,
    issueSend: (client: unknown) => Promise<{ data: { id?: string | null } }>,
    ownMessageId: string,
  ): Promise<string | null>;
  forceFreshTokens(companyId: number): Promise<unknown>;
  logger: { warn: jest.Mock; error: jest.Mock; log: jest.Mock };
}

/** A GaxiosError shaped the way googleapis actually reports one. */
const gaxios = (status: number, message = 'boom') =>
  Object.assign(new Error(message), { response: { status } });

/** A fake gmail client whose messages.list answers the `rfc822msgid:` probe. */
const clientFinding = (found: boolean) => {
  const list = jest.fn().mockResolvedValue({
    data: { messages: found ? [{ id: 'sent-1' }] : [] },
  });
  return { client: { users: { messages: { list } } }, list };
};

describe('GmailService.sendWithRetry', () => {
  let svc: Internals;

  beforeEach(() => {
    svc = new GmailService(
      {} as PrismaService,
      {} as MessageStateService,
    ) as unknown as Internals;
    // The real Logger writes to stderr on every retry path; keep the suite quiet
    // while still allowing the assertions below to read what was logged.
    svc.logger = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    } as unknown as Internals['logger'];
  });

  it('returns the id on a clean send, with no lookup', async () => {
    const { client, list } = clientFinding(false);
    const issueSend = jest.fn().mockResolvedValue({ data: { id: 'm1' } });

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).resolves.toBe('m1');

    expect(issueSend).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  // A 401 is rejected before Gmail looks at the message, so nothing was sent and the
  // retry is unconditionally safe — no lookup needed.
  it('refreshes and retries once on a 401, without checking the mailbox', async () => {
    const { client, list } = clientFinding(false);
    const issueSend = jest
      .fn()
      .mockRejectedValueOnce(gaxios(401))
      .mockResolvedValueOnce({ data: { id: 'm2' } });
    const forceFresh = jest
      .spyOn(svc, 'forceFreshTokens')
      .mockResolvedValue({});

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).resolves.toBe('m2');

    expect(forceFresh).toHaveBeenCalledWith(COMPANY);
    expect(issueSend).toHaveBeenCalledTimes(2);
    expect(list).not.toHaveBeenCalled();
  });

  // THE case this exists for. Gmail accepted the message and then failed on the way
  // back. Re-sending would deliver it twice.
  it.each([429, 500, 503])(
    'does NOT resend after a %s when the message is already in the mailbox',
    async (status) => {
      const { client, list } = clientFinding(true);
      const issueSend = jest.fn().mockRejectedValue(gaxios(status));

      await expect(
        svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
      ).resolves.toBe('sent-1');

      expect(issueSend).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledTimes(1);
      const [query] = argsOf<[{ q: string }]>(list);
      expect(query.q).toBe('rfc822msgid:abc-123@cygfinance.com');
    },
  );

  it('retries once after a 503 when the message is absent', async () => {
    const { client, list } = clientFinding(false);
    const issueSend = jest
      .fn()
      .mockRejectedValueOnce(gaxios(503))
      .mockResolvedValueOnce({ data: { id: 'm3' } });

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).resolves.toBe('m3');

    expect(list).toHaveBeenCalledTimes(1);
    expect(issueSend).toHaveBeenCalledTimes(2);
  });

  it('treats a dropped socket as retryable', async () => {
    const { client } = clientFinding(false);
    const issueSend = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error('read'), {
          code: 'ECONNRESET',
        }),
      )
      .mockResolvedValueOnce({ data: { id: 'm4' } });

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).resolves.toBe('m4');
    expect(issueSend).toHaveBeenCalledTimes(2);
  });

  // If we cannot tell whether it sent, we must assume it did. A duplicate email to a
  // client is worse than an error on a message that actually went out.
  it('assumes the message sent when the lookup itself fails', async () => {
    const list = jest.fn().mockRejectedValue(new Error('list exploded'));
    const client = { users: { messages: { list } } };
    const issueSend = jest.fn().mockRejectedValue(gaxios(503));

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).resolves.toBe('');

    expect(issueSend).toHaveBeenCalledTimes(1);
  });

  // A permanent refusal must surface as itself so translateSendError can word it —
  // retrying a 400 just wastes a round-trip and hides the real cause.
  it.each([400, 403, 404])('rethrows a %s without retrying', async (status) => {
    const { client, list } = clientFinding(false);
    const err = gaxios(status);
    const issueSend = jest.fn().mockRejectedValue(err);

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).rejects.toBe(err);

    expect(issueSend).toHaveBeenCalledTimes(1);
    expect(list).not.toHaveBeenCalled();
  });

  it('gives up after one retry rather than looping', async () => {
    const { client } = clientFinding(false);
    const second = gaxios(503, 'still down');
    const issueSend = jest
      .fn()
      .mockRejectedValueOnce(gaxios(503))
      .mockRejectedValueOnce(second);

    await expect(
      svc.sendWithRetry(COMPANY, client, issueSend, MSG_ID),
    ).rejects.toBe(second);

    expect(issueSend).toHaveBeenCalledTimes(2);
  });
});

/**
 * The wrapper, not the retry: proves `sendEmail` actually routes a raw provider
 * failure through `translateSendError` instead of letting Nest turn it into
 * "Internal server error". Without this the translator could be perfect and still
 * not wired in — which is exactly the bug being fixed.
 */
describe('GmailService.sendEmail error mapping', () => {
  const dto = { to: 'a@b.com', body: '' } as never;

  const serviceWhereLookupFails = (err: unknown) =>
    new GmailService(
      {
        gmailAccount: { findUnique: jest.fn().mockRejectedValue(err) },
      } as unknown as PrismaService,
      {} as MessageStateService,
    );

  it('maps a transient provider failure to 503, not 500', async () => {
    const svc = serviceWhereLookupFails(
      Object.assign(new Error('backend error'), { response: { status: 503 } }),
    );
    const err = (await svc
      .sendEmail(1, dto, [])
      .catch((e: unknown) => e)) as HttpException;

    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(err.message).not.toMatch(/internal server error/i);
  });

  // A mailbox that was never connected must still 404 with its own wording.
  it('leaves an HttpException from the send path intact', async () => {
    const svc = serviceWhereLookupFails(
      new NotFoundException('No Gmail account connected for this company'),
    );
    const err = (await svc
      .sendEmail(1, dto, [])
      .catch((e: unknown) => e)) as HttpException;

    expect(err.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(err.message).toContain('No Gmail account connected');
  });
});
