import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Turn a failed outbound send into something the user can act on.
 *
 * Sending an email was the one path in this codebase with no error mapping at all.
 * Neither `GmailService.sendEmail` nor `MicrosoftService.sendEmail` caught anything,
 * and `main.ts` registers exactly one global filter — `MulterExceptionFilter`, which
 * is `@Catch(MulterError)`. So a `GaxiosError` from Google, a `GraphError` from
 * Microsoft, a plain `Error` from the Drive/OneDrive uploaders, or an `ENOENT` on a
 * staged attachment all fell through to Nest's default filter and reached the
 * composer as `{"statusCode":500,"message":"Internal server error"}` — which the
 * client renders verbatim. Every transient upstream hiccup looked identical, told the
 * user nothing, and left no line anyone could grep.
 *
 * The wording matters as much as the status. A user told the message was NOT sent
 * will retry; one told nothing either retries blindly (risking a duplicate) or
 * assumes it went. So the transient branches say "not sent" explicitly, and
 * `GmailService` only ever re-sends after proving the message did not arrive.
 */

export type SendProvider = 'gmail' | 'outlook';

const LABEL: Record<SendProvider, string> = {
  gmail: 'Gmail',
  outlook: 'Outlook',
};

/**
 * Node/undici socket-level failures. These never reach the provider's application
 * layer, so the message was not accepted and a retry cannot duplicate it.
 */
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ABORT_ERR',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

interface Errorish {
  name?: string;
  message?: string;
  code?: number | string;
  status?: number;
  statusCode?: number;
  graphCode?: string | null;
  cause?: unknown;
  response?: {
    status?: number;
    data?: { error?: { code?: string; message?: string; status?: string } };
  };
  errors?: Array<{ reason?: string; message?: string }>;
}

/**
 * The HTTP status a provider reported, or 0 when the failure never got that far.
 *
 * Gaxios puts it on `response.status`, Graph on `status`. `code` is checked last and
 * deliberately guarded: Gaxios sets it to a STRING like `'ECONNRESET'` as often as to
 * a status, and `Number('ECONNRESET')` is NaN — which must read as "no status", not
 * as a bogus one.
 */
export function sendErrorStatus(err: unknown): number {
  const e = (err ?? {}) as Errorish;
  const raw = e.response?.status ?? e.status ?? e.statusCode ?? e.code;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n >= 100 && n < 600 ? n : 0;
}

/**
 * The provider's own error code (`graphCode`, Google's `reason`, or a Node errno).
 *
 * `errors[0].reason` is preferred over `response.data.error.code` because Google's
 * `error.code` is the numeric HTTP status restated — a 403 whose real cause is
 * `rateLimitExceeded` reports `code: 403`, and returning that would tell the reader
 * nothing the status did not. Graph's `error.code` IS a name, so it is still read,
 * but only when it isn't a bare number.
 */
export function sendErrorCode(err: unknown): string {
  const e = (err ?? {}) as Errorish;
  if (e.graphCode) return e.graphCode;
  const reason = e.errors?.[0]?.reason;
  if (reason) return String(reason);
  const nested = e.response?.data?.error?.code;
  if (nested && !/^\d+$/.test(String(nested))) return String(nested);
  if (typeof e.code === 'string') return e.code;
  return '';
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err === 'number' || typeof err === 'boolean') return String(err);
  // Anything else stringifies to "[object Object]", which is worse than saying so.
  try {
    return JSON.stringify(err) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

/** Node errno / undici code, following one level of `cause` (undici's "fetch failed"). */
function networkCode(err: unknown): string {
  const e = (err ?? {}) as Errorish;
  const own = typeof e.code === 'string' ? e.code : '';
  if (NETWORK_CODES.has(own)) return own;
  const cause = (e.cause ?? {}) as Errorish;
  const inner = typeof cause.code === 'string' ? cause.code : '';
  return NETWORK_CODES.has(inner) ? inner : '';
}

function haystack(err: unknown): string {
  const e = (err ?? {}) as Errorish;
  return [
    messageOf(err),
    sendErrorCode(err),
    e.response?.data?.error?.message ?? '',
    e.response?.data?.error?.status ?? '',
  ]
    .join(' ')
    .toLowerCase();
}

/**
 * An auth failure: the token was rejected, or refreshing it failed.
 *
 * `invalid_grant` is the one that means the mailbox genuinely has to be reconnected
 * (consent revoked, password changed, refresh token idle past Google's limit); a bare
 * 401 is usually just a token that expired mid-send, which the caller retries first.
 */
export function isAuthSendError(err: unknown): boolean {
  if (err instanceof HttpException) return false;
  if (sendErrorStatus(err) === 401) return true;
  const text = haystack(err);
  return (
    text.includes('invalid_grant') ||
    text.includes('invalid_client') ||
    text.includes('unauthorized_client') ||
    text.includes('token has been expired or revoked') ||
    text.includes('invalidauthenticationtoken')
  );
}

/**
 * Worth one more attempt: a throttle, an upstream 5xx, or a dead socket.
 *
 * NOTE this says nothing about whether retrying is SAFE. A 429 or 503 can come back
 * after the provider already accepted the message, so `GmailService` checks whether
 * the message actually landed — by the Message-ID it minted — before re-sending.
 */
export function isRetryableSendError(err: unknown): boolean {
  if (err instanceof HttpException) return false;
  if (networkCode(err)) return true;
  const e = (err ?? {}) as Errorish;
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return true;
  if (messageOf(err).toLowerCase() === 'fetch failed') return true;
  const status = sendErrorStatus(err);
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  const code = sendErrorCode(err).toLowerCase();
  return (
    code === 'ratelimitexceeded' ||
    code === 'userratelimitexceeded' ||
    code === 'applicationthrottled' ||
    code === 'mailboxconcurrency' ||
    code === 'serviceunavailable' ||
    code === 'backenderror'
  );
}

/**
 * Map a send failure onto an HTTP response the composer can show.
 *
 * Logs before returning, always — that line is the whole reason the next report is
 * diagnosable without a repro. Shape mirrors `MicrosoftService.logGraphFailure`.
 */
export function translateSendError(
  err: unknown,
  provider: SendProvider,
  companyId: number,
  logger: Logger,
): HttpException {
  const label = LABEL[provider];
  const status = sendErrorStatus(err);
  const code = sendErrorCode(err);
  const detail = messageOf(err);

  const line =
    `sendEmail failed for company ${companyId} via ${provider}: ` +
    `status=${status || 'none'} code=${code || 'none'} — ${detail}`;

  // A 4xx we raised ourselves is a decision, not a fault: "this mailbox hasn't
  // authorised Drive", "no account connected". Logging those at `error` with a stack
  // trains people to ignore the level, which is precisely what has to stay readable
  // for the failures this module exists to make visible.
  if (err instanceof HttpException && err.getStatus() < 500) {
    logger.warn(line);
  } else {
    logger.error(line, err instanceof Error ? err.stack : undefined);
  }

  // Already an HttpException: the send path throws several carefully-worded
  // BadRequestExceptions (the Drive/OneDrive scope gates, the forward guard) and a
  // NotFoundException for a mailbox that was never connected. Re-wrapping any of them
  // would replace a message the user can act on with a generic one.
  if (err instanceof HttpException) return err;

  const text = haystack(err);

  if (isAuthSendError(err)) {
    return new UnauthorizedException(
      `${label} rejected the sign-in for this mailbox. Open the Communications tab, ` +
        'disconnect it and connect it again, then resend.',
    );
  }

  // A staged attachment vanished before it could be read. Only reachable if the
  // sweep raced a very long send (see sweepStaleOutboundFiles) — the user's move is
  // to re-attach, so say that rather than "internal server error".
  if (code === 'ENOENT') {
    return new BadRequestException(
      'The attachments were cleaned up before the message finished sending. Please ' +
        'attach them again and resend.',
    );
  }

  if (
    status === 413 ||
    text.includes('message too large') ||
    text.includes('request entity too large') ||
    text.includes('errormessagesizeexceeded') ||
    text.includes('maximum message size')
  ) {
    return new BadRequestException(
      'This message is too large to send. Remove or shrink an attachment and try ' +
        'again.',
    );
  }

  if (
    text.includes('errorinvalidrecipients') ||
    text.includes('invalid to header') ||
    text.includes('invalid cc header') ||
    text.includes('invalid bcc header') ||
    text.includes('recipient address rejected')
  ) {
    return new BadRequestException(
      `${label} rejected one of the recipient addresses. Check the To, Cc and Bcc ` +
        'fields and try again.',
    );
  }

  if (isRetryableSendError(err)) {
    return new ServiceUnavailableException(
      `${label} is not responding right now. The message was not sent — please try ` +
        'again in a moment.',
    );
  }

  if (status === 403) {
    return new BadRequestException(
      `${label} refused this send (${code || 'permission denied'}). The mailbox may ` +
        'be missing a permission — disconnecting and reconnecting it usually fixes ' +
        'this.',
    );
  }

  return new HttpException(
    `Couldn't send the message through ${label}${code ? ` (${code})` : ''}. Please ` +
      'try again.',
    HttpStatus.BAD_GATEWAY,
  );
}

/**
 * Map a failed DRAFT write onto an HTTP response.
 *
 * Shares every classifier with `translateSendError` but deliberately not its wording.
 * A failed autosave has not lost anything — the message is still sitting in the
 * composer — so "The message was not sent" would be both wrong and alarming, and
 * "disconnect and reconnect it, then resend" tells the user to do something about a
 * message they are still writing. The composer renders these as a quiet "couldn't
 * save" and tries again on the next change.
 */
export function translateDraftError(
  err: unknown,
  provider: SendProvider,
  companyId: number,
  logger: Logger,
): HttpException {
  const label = LABEL[provider];
  const status = sendErrorStatus(err);
  const code = sendErrorCode(err);
  const detail = messageOf(err);

  const line =
    `draft write failed for company ${companyId} via ${provider}: ` +
    `status=${status || 'none'} code=${code || 'none'} — ${detail}`;
  if (err instanceof HttpException && err.getStatus() < 500) {
    logger.warn(line);
  } else {
    logger.error(line, err instanceof Error ? err.stack : undefined);
  }

  // Same rule as the send path: a 4xx we raised ourselves is a decision, not a fault.
  if (err instanceof HttpException) return err;

  if (isAuthSendError(err)) {
    return new UnauthorizedException(
      `${label} rejected the sign-in for this mailbox, so the draft wasn't saved. ` +
        'Open the Communications tab, disconnect it and connect it again.',
    );
  }

  if (isRetryableSendError(err)) {
    return new ServiceUnavailableException(
      `${label} isn't responding right now, so the draft wasn't saved. Your message ` +
        'is still here and will be saved again automatically.',
    );
  }

  return new HttpException(
    `Couldn't save the draft to ${label}${code ? ` (${code})` : ''}.`,
    HttpStatus.BAD_GATEWAY,
  );
}
