import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verification for SignalWire's webhook signature (`X-Twilio-Signature`).
 *
 * Framework-free and dependency-free on purpose, like `signalwire-parse.ts` and
 * `compute-next-due.ts`: this is the security boundary, so it is the part most worth
 * testing without a network.
 *
 * WHY THIS EXISTS. `/api/phone/voice/inbound` and its siblings are the only routes in
 * this server that are publicly reachable with no JWT — they have to be, because
 * SignalWire is the caller. Without this check anyone who learns the URL can POST a
 * forged `From`/`To` and make the app ring a user, or drive whatever call handling we
 * later hang off these routes. There is no second gate behind them.
 *
 * THE ALGORITHM (Twilio-compatible, which is what the Compatibility API implements):
 *
 *   1. Start with the EXACT URL SignalWire was configured to request, query string
 *      included.
 *   2. If the body is form-encoded, take its params, sort by key, and append
 *      `key + value` for each — no separators.
 *   3. HMAC-SHA1 that string with the API token, base64-encode it.
 *   4. Compare against the `X-Twilio-Signature` header.
 */

/** The header SignalWire signs with. Named for Twilio because the API is a clone. */
export const SIGNATURE_HEADER = 'x-twilio-signature';

/**
 * Builds the exact string SignalWire signed.
 *
 * Exported for the tests, which is the only way to see the sort actually happening.
 * Note the sort is over KEYS and the values are concatenated bare — a param
 * `{b:'2', a:'1'}` signs as `<url>a1b2`, not `<url>a=1&b=2`.
 */
export function signatureBase(
  url: string,
  params: Record<string, unknown>,
): string {
  return Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + String(params[key] ?? ''), url);
}

/** The expected signature for a request. Exported so tests can build valid ones. */
export function computeSignature(
  url: string,
  params: Record<string, unknown>,
  authToken: string,
): string {
  return createHmac('sha1', authToken)
    .update(Buffer.from(signatureBase(url, params), 'utf-8'))
    .digest('base64');
}

/**
 * Constant-time compare of two base64 signatures.
 *
 * `===` on a secret-derived string leaks its content through timing, one byte at a
 * time. `timingSafeEqual` throws when lengths differ, so that case is answered first —
 * and answering it early is safe, because the length of a SHA-1 digest is not a secret.
 */
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf-8');
  const right = Buffer.from(b, 'utf-8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Is this request genuinely from SignalWire?
 *
 * Never throws — a malformed header, a missing token or a weird body is `false`, not a
 * 500. The caller turns `false` into a 403; there is no case where a verification
 * problem should look like a server fault to the sender.
 *
 * `url` MUST be the URL as SignalWire has it configured, not one reassembled from the
 * incoming request. Behind nginx `req.protocol` reports `http` and `req.host` can carry
 * a port, either of which changes the signed string and fails every valid request. The
 * caller builds it from `webhookUrls()` — the same source that told SignalWire where to
 * POST — so the two cannot drift.
 */
export function verifySignature(
  signature: string | undefined,
  url: string,
  params: Record<string, unknown>,
  authToken: string | undefined,
): boolean {
  if (!signature || !authToken) return false;
  try {
    return safeEqual(signature, computeSignature(url, params, authToken));
  } catch {
    return false;
  }
}
