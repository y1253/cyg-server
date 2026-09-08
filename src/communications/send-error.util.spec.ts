import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  isAuthSendError,
  isRetryableSendError,
  sendErrorCode,
  sendErrorStatus,
  translateSendError,
} from './send-error.util';

// A Logger stand-in: the translator logs on every path, and the test must not spam
// stderr. Kept as a spy so the "it logged at all" assertion below is real.
const stubLogger = () =>
  ({ error: jest.fn(), warn: jest.fn() }) as unknown as Logger & {
    error: jest.Mock;
    warn: jest.Mock;
  };

/** A GaxiosError as googleapis actually shapes it. */
const gaxios = (status: number, message = 'boom', reason?: string) =>
  Object.assign(new Error(message), {
    response: {
      status,
      data: { error: { code: String(status), message, ...(reason ? {} : {}) } },
    },
    ...(reason ? { errors: [{ reason }] } : {}),
  });

/** A GraphError as `graph.util.ts` shapes it. */
const graph = (status: number, graphCode: string, message = 'Graph failure') =>
  Object.assign(new Error(message), { status, graphCode, name: 'GraphError' });

const errno = (code: string, message = code) =>
  Object.assign(new Error(message), { code });

describe('sendErrorStatus', () => {
  it('reads a Gaxios status off response.status', () => {
    expect(sendErrorStatus(gaxios(503))).toBe(503);
  });

  it('reads a GraphError status off status', () => {
    expect(sendErrorStatus(graph(429, 'ApplicationThrottled'))).toBe(429);
  });

  // Gaxios sets `code` to a string errno as often as to a status. Number('ECONNRESET')
  // is NaN, and a NaN leaking through as a status would make every branch below misfire.
  it('does not mistake a string errno for a status', () => {
    expect(sendErrorStatus(errno('ECONNRESET'))).toBe(0);
  });

  it('rejects an out-of-range number', () => {
    expect(sendErrorStatus({ status: 99 })).toBe(0);
    expect(sendErrorStatus({ status: 600 })).toBe(0);
  });

  it('is 0 for a bare error', () => {
    expect(sendErrorStatus(new Error('nope'))).toBe(0);
    expect(sendErrorStatus(undefined)).toBe(0);
  });
});

describe('sendErrorCode', () => {
  it('prefers the Graph code', () => {
    expect(sendErrorCode(graph(429, 'MailboxConcurrency'))).toBe(
      'MailboxConcurrency',
    );
  });

  it("falls back to Google's reason", () => {
    expect(sendErrorCode(gaxios(403, 'quota', 'rateLimitExceeded'))).toBe(
      'rateLimitExceeded',
    );
  });

  it('falls back to a Node errno', () => {
    expect(sendErrorCode(errno('ENOENT'))).toBe('ENOENT');
  });
});

describe('isAuthSendError', () => {
  it.each([401])('treats %s as auth', (status) => {
    expect(isAuthSendError(gaxios(status))).toBe(true);
  });

  it('recognises invalid_grant regardless of status', () => {
    expect(isAuthSendError(new Error('invalid_grant'))).toBe(true);
  });

  it('recognises InvalidAuthenticationToken from Graph', () => {
    expect(isAuthSendError(graph(401, 'InvalidAuthenticationToken'))).toBe(
      true,
    );
  });

  it('does not claim a 503 is an auth problem', () => {
    expect(isAuthSendError(gaxios(503))).toBe(false);
  });
});

describe('isRetryableSendError', () => {
  it.each([408, 429, 500, 502, 503, 504])('retries %s', (status) => {
    expect(isRetryableSendError(gaxios(status))).toBe(true);
  });

  it.each(['ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND'])(
    'retries %s',
    (code) => {
      expect(isRetryableSendError(errno(code))).toBe(true);
    },
  );

  // undici hides the real errno one level down and reports "fetch failed" on top.
  it('follows undici cause into the real errno', () => {
    const err = Object.assign(new Error('fetch failed'), {
      cause: errno('ECONNRESET'),
    });
    expect(isRetryableSendError(err)).toBe(true);
  });

  it('retries a named Graph throttle even without a 429', () => {
    expect(isRetryableSendError(graph(0, 'ApplicationThrottled'))).toBe(true);
  });

  it.each([400, 403, 404, 413])('does NOT retry %s', (status) => {
    expect(isRetryableSendError(gaxios(status))).toBe(false);
  });

  // A retry is what risks a duplicate email. An HttpException is a decision this code
  // already made deliberately (a scope gate, a missing mailbox) — never re-attempt it.
  it('never retries an HttpException', () => {
    expect(isRetryableSendError(new BadRequestException('reconnect'))).toBe(
      false,
    );
  });

  it('does not retry a plain unknown error', () => {
    expect(isRetryableSendError(new Error('something odd'))).toBe(false);
  });
});

describe('translateSendError', () => {
  it('always logs, with the company, provider, status and code', () => {
    const logger = stubLogger();
    translateSendError(graph(503, 'ServiceUnavailable'), 'outlook', 42, logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [line] = logger.error.mock.calls[0] as [string];
    expect(line).toContain('company 42');
    expect(line).toContain('outlook');
    expect(line).toContain('503');
    expect(line).toContain('ServiceUnavailable');
  });

  // The send path throws several carefully-worded BadRequestExceptions (the Drive and
  // OneDrive scope gates, the forward guard). Re-wrapping one would silently replace a
  // message the user can act on with a generic one — this is the regression that
  // matters most in this file.
  it('passes an HttpException through UNMODIFIED', () => {
    const original = new BadRequestException(
      'Large attachments are shared through Google Drive, which this mailbox ' +
        "hasn't authorised yet.",
    );
    const out = translateSendError(original, 'gmail', 1, stubLogger());
    expect(out).toBe(original);
    expect(out.getStatus()).toBe(HttpStatus.BAD_REQUEST);
  });

  it('passes a NotFoundException through unmodified', () => {
    const original = new NotFoundException('No Gmail account connected');
    expect(translateSendError(original, 'gmail', 1, stubLogger())).toBe(
      original,
    );
  });

  // A 4xx we raised deliberately is not a fault. Logging it at `error` with a stack
  // is how an error log becomes noise nobody reads — which would defeat the point.
  it('logs a self-raised 4xx at warn, not error', () => {
    const logger = stubLogger();
    translateSendError(
      new BadRequestException('reconnect'),
      'gmail',
      1,
      logger,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a genuine provider failure at error, with the stack', () => {
    const logger = stubLogger();
    translateSendError(gaxios(503), 'gmail', 1, logger);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const [, stack] = logger.error.mock.calls[0] as [string, string];
    expect(stack).toEqual(expect.any(String));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('maps a 401 to 401 with reconnect wording', () => {
    const out = translateSendError(gaxios(401), 'gmail', 1, stubLogger());
    expect(out.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(out.message).toMatch(/disconnect it and connect it again/i);
    expect(out.message).toContain('Gmail');
  });

  it('maps invalid_grant from a token refresh to the same reconnect message', () => {
    const out = translateSendError(
      new Error('invalid_grant: Token has been expired or revoked.'),
      'gmail',
      1,
      stubLogger(),
    );
    expect(out.getStatus()).toBe(HttpStatus.UNAUTHORIZED);
  });

  // The whole point of the wording: a user who knows it was NOT sent will retry.
  it.each([429, 503])('maps %s to 503 saying the message was not sent', (s) => {
    const out = translateSendError(gaxios(s), 'gmail', 1, stubLogger());
    expect(out.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(out.message).toMatch(/was not sent/i);
  });

  it('maps a dropped socket to the same 503', () => {
    const out = translateSendError(
      errno('ECONNRESET'),
      'outlook',
      1,
      stubLogger(),
    );
    expect(out.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(out.message).toContain('Outlook');
  });

  it('maps a vanished staged attachment to a re-attach message', () => {
    const out = translateSendError(
      errno('ENOENT', "ENOENT: no such file or directory, open '/x/y.pdf'"),
      'gmail',
      1,
      stubLogger(),
    );
    expect(out.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(out.message).toMatch(/attach them again/i);
  });

  it.each([
    [gaxios(413, 'Request Entity Too Large')],
    [gaxios(400, 'Message too large')],
    [graph(400, 'ErrorMessageSizeExceeded')],
  ])('maps an oversized message to an actionable 400', (err) => {
    const out = translateSendError(err, 'gmail', 1, stubLogger());
    expect(out.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(out.message).toMatch(/too large/i);
  });

  it('maps a rejected recipient to a 400 naming the fields', () => {
    const out = translateSendError(
      graph(400, 'ErrorInvalidRecipients'),
      'outlook',
      1,
      stubLogger(),
    );
    expect(out.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(out.message).toMatch(/To, Cc and Bcc/);
  });

  it('maps a 403 to a permission hint rather than a bare failure', () => {
    const out = translateSendError(
      gaxios(403, 'forbidden', 'forbidden'),
      'gmail',
      1,
      stubLogger(),
    );
    expect(out.getStatus()).toBe(HttpStatus.BAD_REQUEST);
    expect(out.message).toMatch(/reconnecting/i);
  });

  // The catch-all still has to beat "Internal server error": it names the provider and
  // tells the user to retry.
  it('falls back to a 502 that names the provider', () => {
    const out = translateSendError(
      new Error('something nobody anticipated'),
      'outlook',
      1,
      stubLogger(),
    );
    expect(out).toBeInstanceOf(HttpException);
    expect(out.getStatus()).toBe(HttpStatus.BAD_GATEWAY);
    expect(out.message).toContain('Outlook');
    expect(out.message).not.toMatch(/internal server error/i);
  });
});
