/**
 * Pure parsing and validation helpers for the SignalWire Compatibility (LaML) API.
 *
 * Framework-free and dependency-free on purpose, exactly like `luxand-parse.ts`: this
 * is the layer worth testing without a network, and every shape in here was pinned
 * against the live API by `scripts/signalwire-probe.mjs` rather than taken from docs.
 */

export type SignalWireJson = Record<string, unknown> | unknown[] | null;

/**
 * One capability as SignalWire reported it: `true`, `false`, or `null` for NOT REPORTED.
 *
 * The third state is the whole point. A response that omits `capabilities` is telling us
 * nothing, which is not the same as telling us `false` — and the two directions we use
 * these flags in want opposite defaults:
 *
 *   search   → fail CLOSED. Only an explicit `true` puts a number in front of an admin.
 *   purchase → fail OPEN. Only an explicit `false` throws away a number already paid for.
 *
 * Collapsing that back into a plain boolean is what caused a bought number to be
 * released again; see PhoneProvisioningService.attachNumber.
 */
export type CapabilityFlag = boolean | null;

/** A number that can be purchased, as returned by AvailablePhoneNumbers search. */
export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string | null;
  /** Province / state, e.g. 'QC'. The ONLY trustworthy geographic field — see notes below. */
  region: string | null;
  rateCenter: string | null;
  locality: string | null;
  /** Strict booleans: "not reported" is collapsed to `false` on purpose — see below. */
  voice: boolean;
  sms: boolean;
  mms: boolean;
}

/** A number we own, as returned by POST/GET IncomingPhoneNumbers. */
export interface PurchasedNumber {
  sid: string;
  phoneNumber: string;
  friendlyName: string | null;
  voiceUrl: string | null;
  smsUrl: string | null;
  /** Tri-state: `null` means SignalWire did not report it. Do NOT read these with `!`. */
  voice: CapabilityFlag;
  sms: CapabilityFlag;
  mms: CapabilityFlag;
  /**
   * The `capabilities` value exactly as it arrived, JSON-encoded, or null if absent.
   *
   * A verbatim echo rather than an interpretation: the shape of this field on the
   * purchase response has never actually been observed (the probe is read-only and only
   * ever saw the SEARCH shape), so when a flag reads `null` this is the only evidence of
   * why. Logged by SignalWireService.purchaseNumber.
   */
  capabilitiesRaw: string | null;
}

/** The two NANP countries we sell into. */
export type IsoCountry = 'US' | 'CA';

/**
 * Maps the free-text `Company.country` column onto a country key.
 *
 * `'USA'` and `'CANADA'` are the only values the register wizard produces
 * (`register-company.dto.ts` pins them with `@IsIn`), but the column is a nullable
 * String that predates that validation, so anything can be in an old row. Anything
 * unrecognised returns null and the caller SKIPS — never guesses. Guessing here would
 * buy a number in the wrong country, which costs money and cannot be undone.
 *
 * Note this does NOT select geography by itself: SignalWire ignores the country
 * segment in the search URL (verified — `/XX/Local` and `/GB/Local` both return US
 * numbers). It only chooses which region list to search. See `phone.config.ts`.
 */
export function toIsoCountry(
  country: string | null | undefined,
): IsoCountry | null {
  switch ((country ?? '').trim().toUpperCase()) {
    case 'USA':
    case 'US':
      return 'US';
    case 'CANADA':
    case 'CA':
      return 'CA';
    default:
      return null;
  }
}

/** NANP area codes are 3 digits and never start with 0 or 1. */
export function isValidAreaCode(value: string | null | undefined): boolean {
  return /^[2-9]\d{2}$/.test((value ?? '').trim());
}

/** E.164: a leading +, a non-zero country digit, then 7–14 more digits. */
export function isE164(value: string | null | undefined): boolean {
  return /^\+[1-9]\d{7,14}$/.test((value ?? '').trim());
}

/** Digits 2–4 of a NANP (+1) number, or null for anything else. */
export function areaCodeOf(e164: string | null | undefined): string | null {
  const m = /^\+1(\d{3})\d{7}$/.exec((e164 ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Reads one capability flag, case-insensitively, as a tri-state.
 *
 * The case-insensitivity exists because SignalWire is genuinely inconsistent: the search
 * response uses `voice` lowercase but `SMS` / `MMS` UPPERCASE (verified against the live
 * API), while the docs for the purchase response show all three lowercase. Getting that
 * wrong is not cosmetic — capabilities GATE number selection, so a casing mistake
 * silently filters out every candidate and surfaces as "no numbers available", which
 * looks like an inventory problem rather than a parsing one.
 *
 * The tri-state exists because the two callers want opposite defaults, and the old
 * boolean version served only one of them. `null` is returned for a missing
 * `capabilities` object, a missing key, and any NON-BOOLEAN value.
 *
 * Non-boolean deliberately does not coerce. A `1` or a `'yes'` is a shape we have never
 * seen from this API, so reading it as `true` would be inventing a capability we cannot
 * text from; reading it as `false` would be inventing evidence against a number the
 * search already cleared. "We do not know" is the only honest answer, and each caller
 * resolves it in the direction that is safe for what it is about to do.
 */
function capabilityOf(caps: unknown, name: string): CapabilityFlag {
  if (!caps || typeof caps !== 'object') return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(caps as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted) {
      return typeof value === 'boolean' ? value : null;
    }
  }
  return null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Parses an AvailablePhoneNumbers search response.
 *
 * Never throws and never returns a partial row: anything without a usable
 * `phone_number` is dropped, because the phone number is what a later call spends
 * money on. A malformed body yields `[]`, which the caller treats as "no inventory".
 */
export function parseAvailableNumbers(data: SignalWireJson): AvailableNumber[] {
  const list = (data as Record<string, unknown> | null)?.[
    'available_phone_numbers'
  ];
  if (!Array.isArray(list)) return [];

  const out: AvailableNumber[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    const phoneNumber = str(row.phone_number);
    if (!phoneNumber || !isE164(phoneNumber)) continue;
    out.push({
      phoneNumber,
      friendlyName: str(row.friendly_name),
      region: str(row.region),
      rateCenter: str(row.rate_center),
      locality: str(row.locality),
      // `=== true` collapses the tri-state fail-CLOSED: a number whose capabilities
      // SignalWire declined to report is never offered to an admin, exactly as before.
      voice: capabilityOf(row.capabilities, 'voice') === true,
      sms: capabilityOf(row.capabilities, 'sms') === true,
      mms: capabilityOf(row.capabilities, 'mms') === true,
    });
  }
  return out;
}

/**
 * Parses a purchase (or fetch) of an IncomingPhoneNumber.
 *
 * Returns null rather than throwing on a shape we don't recognise. The caller treats
 * null as a failed purchase and runs its compensating release — losing the SID here
 * would mean paying for a number we can no longer address.
 */
export function parsePurchasedNumber(
  data: SignalWireJson,
): PurchasedNumber | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const row = data;
  const sid = str(row.sid);
  const phoneNumber = str(row.phone_number);
  if (!sid || !phoneNumber) return null;
  return {
    sid,
    phoneNumber,
    friendlyName: str(row.friendly_name),
    voiceUrl: str(row.voice_url),
    smsUrl: str(row.sms_url),
    // Tri-state kept intact here — the caller has already paid, so it needs to tell
    // "SignalWire says no" apart from "SignalWire said nothing".
    voice: capabilityOf(row.capabilities, 'voice'),
    sms: capabilityOf(row.capabilities, 'sms'),
    mms: capabilityOf(row.capabilities, 'mms'),
    capabilitiesRaw:
      row.capabilities === undefined ? null : JSON.stringify(row.capabilities),
  };
}

/** Parses a list of owned numbers (GET IncomingPhoneNumbers). */
export function parseOwnedNumbers(data: SignalWireJson): PurchasedNumber[] {
  const list = (data as Record<string, unknown> | null)?.[
    'incoming_phone_numbers'
  ];
  if (!Array.isArray(list)) return [];
  return list
    .map((row) => parsePurchasedNumber(row as SignalWireJson))
    .filter((n): n is PurchasedNumber => n !== null);
}

/**
 * Best available human-readable reason from an error body.
 *
 * SignalWire returns `{ code, message, more_info }` on a well-formed error, but a
 * gateway or proxy failure can produce HTML or an empty body — hence the raw fallback,
 * truncated so a stray HTML page cannot flood the logs.
 */
export function signalwireErrorMessage(
  data: SignalWireJson,
  raw: string,
): string {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const row = data;
    const message = str(row.message);
    // Only a scalar code is worth appending — an object would stringify to
    // "[object Object]" and make the message worse than no code at all.
    const code = row.code;
    const codeText =
      typeof code === 'number' || typeof code === 'string'
        ? String(code)
        : null;
    if (message) return codeText ? `${message} (code ${codeText})` : message;
  }
  const trimmed = (raw ?? '').trim();
  return trimmed ? trimmed.slice(0, 300) : 'empty response body';
}

// ─── Calls, messages and recordings ──────────────────────────────────────────
//
// Everything below was pinned against the live account with
// `scripts/signalwire-calls-probe.mjs`, not taken from the docs. Two of those
// findings are load-bearing here and are repeated where they bite:
//   * SIDs are UUIDs, so nothing may infer a resource type from a prefix;
//   * timestamps arrive RFC-2822, so nothing may string-compare or slice them.

/** A call leg, as `GET /Calls` reports it. */
export interface SwCall {
  sid: string;
  /** Set on the child leg of a `<Dial>`; null on the leg the caller dialled. */
  parentCallSid: string | null;
  to: string;
  from: string;
  /** `inbound` | `outbound-api` | `outbound-dial`. Kept raw — see `isOutbound`. */
  direction: string;
  status: string;
  /** Milliseconds since epoch. Never null: an unparseable row is dropped. */
  startedAt: number;
  durationSec: number;
}

/** An SMS/MMS, as `GET /Messages` reports it. */
export interface SwMessage {
  sid: string;
  to: string;
  from: string;
  direction: string;
  status: string;
  body: string;
  numMedia: number;
  sentAt: number;
  errorCode: number | null;
}

/** A recording, as `GET /Recordings` reports it. */
export interface SwRecording {
  sid: string;
  callSid: string | null;
  durationSec: number;
  status: string;
  createdAt: number | null;
}

/**
 * An RFC-2822 timestamp to epoch ms, or `null`.
 *
 * The Compatibility API returns `"Fri, 28 Aug 2026 16:54:13 +0000"` on every date
 * field — NOT ISO 8601, whatever the docs imply. `new Date()` parses it correctly;
 * the danger is code that slices or string-compares a timestamp, so this is the only
 * place a raw one is read.
 *
 * Returning null rather than 0 for an unparseable value is deliberate. A row that
 * sorted to the epoch would drag the client's watermark cutoff to 0, which disables
 * the inbox clamp entirely and brings back the half-loaded out-of-order tail it
 * exists to prevent. Callers drop such a row instead.
 */
export function parseSwDate(value: unknown): number | null {
  if (typeof value !== 'string' || value === '') return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Is this leg outbound?
 *
 * Tested with a prefix, never against an enumerated list: SignalWire reports
 * `outbound-api` and `outbound-dial` on calls and adds `outbound-call` and
 * `outbound-reply` on messages, beyond Twilio's set. A whitelist would silently
 * classify an unfamiliar outbound value as inbound, which would then be shown to a
 * user as an unread message they actually sent.
 */
export function isOutbound(direction: string | null | undefined): boolean {
  return (direction ?? '').toLowerCase().startsWith('outbound');
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseCall(row: unknown): SwCall | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const sid = str(r.sid);
  const startedAt = parseSwDate(r.start_time) ?? parseSwDate(r.date_created);
  // No sid means we cannot key state on it; no date means we cannot sort it.
  if (!sid || startedAt === null) return null;
  return {
    sid,
    parentCallSid: str(r.parent_call_sid),
    to: str(r.to) ?? '',
    from: str(r.from) ?? '',
    direction: str(r.direction) ?? '',
    status: str(r.status) ?? '',
    startedAt,
    durationSec: num(r.duration),
  };
}

/** Parses `GET /Calls`. List key is `calls`. */
export function parseCalls(data: SignalWireJson): SwCall[] {
  const list = (data as Record<string, unknown> | null)?.['calls'];
  if (!Array.isArray(list)) return [];
  return list.map(parseCall).filter((c): c is SwCall => c !== null);
}

function parseMessage(row: unknown): SwMessage | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const r = row as Record<string, unknown>;
  const sid = str(r.sid);
  const sentAt = parseSwDate(r.date_sent) ?? parseSwDate(r.date_created);
  if (!sid || sentAt === null) return null;
  const errorCode = r.error_code;
  return {
    sid,
    to: str(r.to) ?? '',
    from: str(r.from) ?? '',
    direction: str(r.direction) ?? '',
    status: str(r.status) ?? '',
    // An empty body is legitimate on an MMS, so '' is a value, not a failure.
    body: typeof r.body === 'string' ? r.body : '',
    numMedia: num(r.num_media),
    sentAt,
    errorCode: typeof errorCode === 'number' ? errorCode : null,
  };
}

/** Parses `GET /Messages`. List key is `messages`. */
export function parseMessages(data: SignalWireJson): SwMessage[] {
  const list = (data as Record<string, unknown> | null)?.['messages'];
  if (!Array.isArray(list)) return [];
  return list.map(parseMessage).filter((m): m is SwMessage => m !== null);
}

/**
 * Parses `GET /Recordings`. List key is `recordings`.
 *
 * Note the media sub-resource of a MESSAGE keys on `media_list`, not `media` — a
 * different endpoint and a different key; do not unify them.
 */
export function parseRecordings(data: SignalWireJson): SwRecording[] {
  const list = (data as Record<string, unknown> | null)?.['recordings'];
  if (!Array.isArray(list)) return [];
  return list
    .map((row): SwRecording | null => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
      const r = row as Record<string, unknown>;
      const sid = str(r.sid);
      if (!sid) return null;
      return {
        sid,
        callSid: str(r.call_sid),
        durationSec: num(r.duration),
        status: str(r.status) ?? '',
        createdAt: parseSwDate(r.date_created),
      };
    })
    .filter((r): r is SwRecording => r !== null);
}
