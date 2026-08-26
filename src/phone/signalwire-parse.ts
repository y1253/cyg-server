/**
 * Pure parsing and validation helpers for the SignalWire Compatibility (LaML) API.
 *
 * Framework-free and dependency-free on purpose, exactly like `luxand-parse.ts`: this
 * is the layer worth testing without a network, and every shape in here was pinned
 * against the live API by `scripts/signalwire-probe.mjs` rather than taken from docs.
 */

export type SignalWireJson = Record<string, unknown> | unknown[] | null;

/** A number that can be purchased, as returned by AvailablePhoneNumbers search. */
export interface AvailableNumber {
  phoneNumber: string;
  friendlyName: string | null;
  /** Province / state, e.g. 'QC'. The ONLY trustworthy geographic field — see notes below. */
  region: string | null;
  rateCenter: string | null;
  locality: string | null;
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
  voice: boolean;
  sms: boolean;
  mms: boolean;
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
 * Reads one capability flag, case-insensitively.
 *
 * This exists because SignalWire is genuinely inconsistent: the search response uses
 * `voice` lowercase but `SMS` / `MMS` UPPERCASE (verified against the live API), while
 * the docs for the purchase response show all three lowercase.
 *
 * Getting this wrong is not a cosmetic bug. Capabilities GATE number selection — we
 * refuse to buy anything that is not both voice- and SMS-capable — so a casing mistake
 * silently filters out every candidate and surfaces as "no numbers available", which
 * looks like an inventory problem rather than a parsing one.
 */
function capability(caps: unknown, name: string): boolean {
  if (!caps || typeof caps !== 'object') return false;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(caps as Record<string, unknown>)) {
    if (key.toLowerCase() === wanted) return value === true;
  }
  return false;
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
      voice: capability(row.capabilities, 'voice'),
      sms: capability(row.capabilities, 'sms'),
      mms: capability(row.capabilities, 'mms'),
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
    voice: capability(row.capabilities, 'voice'),
    sms: capability(row.capabilities, 'sms'),
    mms: capability(row.capabilities, 'mms'),
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
