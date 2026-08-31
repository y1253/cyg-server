/**
 * LaML (Twilio-compatible XML) builders.
 *
 * Pure string functions with no framework and no network, for the same reason
 * `signalwire-parse.ts` and `compute-next-due.ts` are separate: this is logic worth
 * testing exhaustively, and a webhook that returns malformed XML fails as
 * "this call cannot be completed" with nothing in our logs to explain it.
 *
 * Everything interpolated goes through `esc()`. A company's `businessName` reaches
 * `<Say>` and an apostrophe in "O'Brien Bookkeeping" would otherwise produce XML that
 * SignalWire rejects — the caller hears the generic failure and the cause is invisible.
 */

/** XML-escape. Covers the five predefined entities; nothing else is special in XML. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wraps children in the `<Response>` envelope every LaML document needs. */
function response(children: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${children}</Response>`;
}

/**
 * An empty `<Response/>`.
 *
 * The correct answer to a status callback or an inbound SMS we do not act on. Note it
 * is NOT the same as returning nothing: a 404 or an empty body is what produced the
 * "call cannot be completed" failure this module exists to fix.
 */
export function emptyResponse(): string {
  return response('');
}

/** Text-to-speech, then continue. */
export function say(text: string, opts: { voice?: string } = {}): string {
  const voice = opts.voice ? ` voice="${esc(opts.voice)}"` : '';
  return response(`<Say${voice}>${esc(text)}</Say>`);
}

/** Speak a message and then end the call. */
export function sayAndHangup(text: string, opts: { voice?: string } = {}): string {
  const voice = opts.voice ? ` voice="${esc(opts.voice)}"` : '';
  return response(`<Say${voice}>${esc(text)}</Say><Hangup/>`);
}

/** End the call immediately. */
export function hangup(): string {
  return response('<Hangup/>');
}

export interface SipTarget {
  /** Full SIP URI without the scheme, e.g. `cyg_u12@cygfinance.sip.signalwire.com`. */
  uri: string;
  /**
   * Extra headers passed as URI params (`?X-Company-Id=42`).
   *
   * This is how the browser learns WHICH company the caller dialled — the INVITE is
   * the only thing it receives, and the SIP identity in it is the user's own, which
   * says nothing about the company. Values are URL-encoded, then XML-escaped.
   */
  headers?: Record<string, string | number>;
}

export interface DialOptions {
  /** Seconds to ring before giving up. SignalWire's default is 30. */
  timeout?: number;
  /** Caller ID shown to the callee. For outbound, the company's support number. */
  callerId?: string;
  /** Where SignalWire reports how the dial ended. */
  action?: string;
  /**
   * Recording mode: `record-from-answer`, `record-from-answer-dual`,
   * `record-from-ringing`, `record-from-ringing-dual`, or `do-not-record`.
   *
   * Deliberately a string, not a boolean. The `-dual` variants put each party on its
   * own channel, which is what makes a recording actually reviewable; collapsing this
   * to `record: true` would silently pick the mono form and there would be no way to
   * ask for the useful one.
   *
   * Recording is billed per minute plus storage, and recording a call carries consent
   * obligations that vary by jurisdiction — so callers gate it on PHONE_RECORD_CALLS
   * rather than hard-coding it here.
   */
  record?: string;
}

/** Serialises one `<Sip>` noun, headers folded into the URI as query params. */
function sipNoun(target: SipTarget): string {
  const params = Object.entries(target.headers ?? {})
    .map(
      ([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
    )
    .join('&');
  return `<Sip>${esc(`sip:${target.uri}${params ? `?${params}` : ''}`)}</Sip>`;
}

function dialAttrs(opts: DialOptions): string {
  return [
    opts.timeout !== undefined ? ` timeout="${esc(opts.timeout)}"` : '',
    opts.callerId ? ` callerId="${esc(opts.callerId)}"` : '',
    opts.action ? ` action="${esc(opts.action)}"` : '',
    opts.record ? ` record="${esc(opts.record)}"` : '',
  ].join('');
}

/**
 * Ring one or more SIP endpoints.
 *
 * Multiple `<Sip>` nouns inside ONE `<Dial>` ring simultaneously and the first to
 * answer wins — that is the ring-group behaviour the unassigned-company fallback
 * needs, and it is free here. Separate `<Dial>` verbs would ring them in sequence
 * instead, which is a different feature; do not "simplify" this into a loop.
 *
 * An empty target list yields no `<Dial>` at all, which would silently connect the
 * caller to nothing, so that case is the caller's to handle — see the webhook.
 */
export function dialSip(targets: SipTarget[], opts: DialOptions = {}): string {
  return response(
    `<Dial${dialAttrs(opts)}>${targets.map(sipNoun).join('')}</Dial>`,
  );
}

/** Dial a PSTN number — the outbound leg, with the company's number as caller ID. */
export function dialNumber(e164: string, opts: DialOptions = {}): string {
  return response(`<Dial${dialAttrs(opts)}><Number>${esc(e164)}</Number></Dial>`);
}
