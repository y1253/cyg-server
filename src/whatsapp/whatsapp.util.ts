import { createHmac, timingSafeEqual } from 'crypto';
import type {
  WhatsAppDeliveryStatus,
  WhatsAppMessageType,
  WhatsAppTemplateDto,
} from './whatsapp.types.js';

/**
 * Pure rules for the WhatsApp Cloud API integration. No Nest, no DB, no network —
 * unit-tested directly in `whatsapp.util.spec.ts`.
 */

// ── Ids ──────────────────────────────────────────────────────────────────────

/**
 * Inbox item ids are namespaced, mirroring `swcall:` / `swsms:`: the merged inbox keys
 * rows and bulk selection off one string space, and a bare numeric id would collide
 * with other channels. The id inside is OUR autoincrement, never Meta's wamid, which is
 * base64-ish and not something to push through a path segment.
 */
export const WHATSAPP_ITEM_PREFIX = 'wa:';

export function whatsappItemId(messageId: number): string {
  return `${WHATSAPP_ITEM_PREFIX}${messageId}`;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface WhatsAppConfig {
  appId: string | null;
  appSecret: string | null;
  configId: string | null;
  verifyToken: string | null;
  graphVersion: string;
  firmToken: string | null;
  firmPhoneNumberId: string | null;
  firmWabaId: string | null;
  /**
   * The display name every GENERATED number is created under. One firm-wide name, not
   * the company's: Meta reviews it against the business that owns the WABA, and
   * registered names like "9498-5140 Québec inc., logistics" are rejected outright
   * (subcode 2388009).
   */
  displayName: string;
}

/**
 * A BLANK value is skipped, not returned. `WHATSAPP_TOKEN=` is an empty string, and `??`
 * would hand it back as though it were a token — the same trap `phone.config.ts` was
 * hardened against.
 */
function pick(env: NodeJS.ProcessEnv, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

export function whatsappConfig(env: NodeJS.ProcessEnv): WhatsAppConfig {
  return {
    appId: pick(env, 'WHATSAPP_ID'),
    appSecret: pick(env, 'WHATSAPP_SECRET'),
    configId: pick(env, 'WHATSAPP_CONFIG_ID'),
    verifyToken: pick(env, 'WHATSAPP_VERIFY_TOKEN'),
    graphVersion: pick(env, 'WHATSAPP_GRAPH_VERSION') ?? 'v23.0',
    firmToken: pick(env, 'WHATSAPP_TOKEN'),
    firmPhoneNumberId: pick(env, 'WHATSAPP_PHONE_NUMBER_ID'),
    firmWabaId: pick(env, 'WHATSAPP_BUSINESS_ACCOUNT_ID'),
    displayName: pick(env, 'WHATSAPP_DISPLAY_NAME') ?? 'CygFinance',
  };
}

// ── Webhook signature ────────────────────────────────────────────────────────

/**
 * `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 of the RAW request body, keyed by the
 * app secret.
 *
 * Fails CLOSED on a missing secret: the webhook is a public route, and an unset secret
 * that accepts everything is the classic fail-open (the `SIGNALWIRE_SIGN_KEY` rule).
 * It must be the raw bytes — re-serialising the parsed JSON changes key order and
 * escaping and fails every genuine delivery.
 */
export function verifyMetaSignature(
  rawBody: Buffer | undefined,
  header: string | undefined,
  secret: string | null,
): boolean {
  if (!secret || !rawBody || !header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const given = Buffer.from(match[1], 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ── Values ───────────────────────────────────────────────────────────────────

/**
 * A WhatsApp id as digits only, or null.
 *
 * Accepts the characters a human types around a number and nothing else, so garbage
 * containing letters is rejected rather than having its digits scavenged into a number.
 */
export function normalizeWaId(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const text = String(raw).trim();
  if (!/^\+?[\d\s().-]+$/.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  return /^\d{6,15}$/.test(digits) ? digits : null;
}

/**
 * Meta timestamps are Unix SECONDS as a string. An unparseable one falls back to the
 * receive time, NEVER 0 — epoch 0 sorts a message to the bottom of a newest-first inbox,
 * and drags the client's watermark clamp down with it.
 */
export function parseWaTimestamp(raw: unknown, fallback: Date): Date {
  const seconds = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return new Date(seconds * 1000);
}

/** Free-form replies are only accepted within 24h of the customer's last message. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowOpenUntil(lastInboundAt: Date | null): Date | null {
  return lastInboundAt
    ? new Date(lastInboundAt.getTime() + REPLY_WINDOW_MS)
    : null;
}

export function isWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  const until = windowOpenUntil(lastInboundAt);
  return until !== null && now.getTime() < until.getTime();
}

const STATUS_RANK: Record<WhatsAppDeliveryStatus, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  failed: 4,
};

/**
 * Status callbacks can arrive out of order (a `read` before its `delivered`), so a status
 * only ever moves forward. `failed` is terminal.
 */
export function nextDeliveryStatus(
  current: string | null,
  incoming: WhatsAppDeliveryStatus,
): WhatsAppDeliveryStatus {
  if (current === 'failed') return 'failed';
  const currentRank =
    current && current in STATUS_RANK
      ? STATUS_RANK[current as WhatsAppDeliveryStatus]
      : 0;
  return STATUS_RANK[incoming] > currentRank
    ? incoming
    : (current as WhatsAppDeliveryStatus);
}

// ── Webhook payload ──────────────────────────────────────────────────────────

export interface ParsedInboundMessage {
  wamid: string;
  from: string;
  profileName: string | null;
  type: WhatsAppMessageType;
  body: string | null;
  mediaId: string | null;
  mimeType: string | null;
  filename: string | null;
  isVoice: boolean;
  at: Date;
  /** WhatsApp's native quote: the `wamid` this message answers, or null. */
  replyToWamid: string | null;
}

export interface ParsedStatus {
  wamid: string;
  status: WhatsAppDeliveryStatus;
  errorCode: string | null;
}

export interface ParsedChange {
  phoneNumberId: string;
  messages: ParsedInboundMessage[];
  statuses: ParsedStatus[];
}

type Json = Record<string, unknown>;

function obj(value: unknown): Json | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : null;
}

function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);

const DELIVERY_STATUSES = new Set<string>([
  'sent',
  'delivered',
  'read',
  'failed',
]);

function parseMessage(
  raw: unknown,
  profiles: Map<string, string>,
  now: Date,
): ParsedInboundMessage | null {
  const m = obj(raw);
  const wamid = str(m?.id);
  const from = normalizeWaId(m?.from);
  if (!m || !wamid || !from) return null;

  const base: ParsedInboundMessage = {
    wamid,
    from,
    profileName: profiles.get(from) ?? null,
    type: 'unsupported',
    body: null,
    mediaId: null,
    mimeType: null,
    filename: null,
    isVoice: false,
    at: parseWaTimestamp(m.timestamp, now),
    // Meta puts the quoted message's id here when the customer used Reply. Read once on
    // the base so every per-type branch below inherits it — a reply can be a photo or a
    // voice note just as easily as text.
    replyToWamid: str(obj(m.context)?.id) ?? null,
  };

  const type = str(m.type) ?? '';

  if (type === 'text') {
    return { ...base, type: 'text', body: str(obj(m.text)?.body) };
  }

  if (MEDIA_TYPES.has(type)) {
    const media = obj(m[type]);
    const mediaId = str(media?.id);
    return {
      ...base,
      type: type as WhatsAppMessageType,
      body: str(media?.caption),
      mediaId,
      mimeType: str(media?.mime_type),
      filename: type === 'document' ? str(media?.filename) : null,
      isVoice: type === 'audio' && media?.voice === true,
    };
  }

  if (type === 'location') {
    const loc = obj(m.location);
    const label = [str(loc?.name), str(loc?.address)]
      .filter(Boolean)
      .join(', ');
    const coords =
      typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number'
        ? `${loc.latitude}, ${loc.longitude}`
        : null;
    return { ...base, type: 'location', body: label || coords };
  }

  if (type === 'contacts') {
    const names = arr(m.contacts)
      .map((c) => str(obj(obj(c)?.name)?.formatted_name))
      .filter((n): n is string => n !== null);
    return {
      ...base,
      type: 'contacts',
      body: names.length
        ? `Shared contact: ${names.join(', ')}`
        : 'Shared a contact',
    };
  }

  if (type === 'reaction') {
    const emoji = str(obj(m.reaction)?.emoji);
    return {
      ...base,
      type: 'reaction',
      body: emoji ? `Reacted ${emoji}` : 'Removed a reaction',
    };
  }

  if (type === 'interactive') {
    const interactive = obj(m.interactive);
    const title =
      str(obj(interactive?.button_reply)?.title) ??
      str(obj(interactive?.list_reply)?.title);
    return { ...base, type: 'interactive', body: title };
  }

  if (type === 'button') {
    return { ...base, type: 'button', body: str(obj(m.button)?.text) };
  }

  // Kept as a row rather than dropped: a customer who sent something we cannot render
  // still sent something, and the conversation should say so.
  return base;
}

function parseStatus(raw: unknown): ParsedStatus | null {
  const s = obj(raw);
  const wamid = str(s?.id);
  const status = str(s?.status);
  if (!s || !wamid || !status || !DELIVERY_STATUSES.has(status)) return null;
  const code = obj(arr(s.errors)[0])?.code;
  return {
    wamid,
    status: status as WhatsAppDeliveryStatus,
    errorCode:
      typeof code === 'number' || typeof code === 'string'
        ? String(code)
        : null,
  };
}

/**
 * Every `messages` change in a webhook delivery, one per business number.
 *
 * Never throws: a shape we do not understand yields nothing, and the controller has
 * already answered 200 by the time this runs.
 */
export function parseWebhook(body: unknown, now = new Date()): ParsedChange[] {
  const root = obj(body);
  if (root?.object !== 'whatsapp_business_account') return [];

  const out: ParsedChange[] = [];
  for (const entry of arr(root.entry)) {
    for (const rawChange of arr(obj(entry)?.changes)) {
      const change = obj(rawChange);
      if (change?.field !== 'messages') continue;
      const value = obj(change.value);
      const phoneNumberId = str(obj(value?.metadata)?.phone_number_id);
      if (!value || !phoneNumberId) continue;

      const profiles = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = normalizeWaId(obj(c)?.wa_id);
        const name = str(obj(obj(c)?.profile)?.name);
        if (waId && name) profiles.set(waId, name);
      }

      out.push({
        phoneNumberId,
        messages: arr(value.messages)
          .map((m) => parseMessage(m, profiles, now))
          .filter((m): m is ParsedInboundMessage => m !== null),
        statuses: arr(value.statuses)
          .map(parseStatus)
          .filter((s): s is ParsedStatus => s !== null),
      });
    }
  }
  return out;
}

/** The `error` object Graph puts on a failed response, or null. */
export function graphErrorOf(
  data: unknown,
): { message: string; code: number | null; subcode: number | null } | null {
  const error = obj(obj(data)?.error);
  if (!error) return null;
  return {
    message:
      str(error.error_user_msg) ?? str(error.message) ?? 'WhatsApp error',
    code: typeof error.code === 'number' ? error.code : null,
    subcode:
      typeof error.error_subcode === 'number' ? error.error_subcode : null,
  };
}

// ── Media ────────────────────────────────────────────────────────────────────

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
};

/**
 * What WhatsApp will render this file AS.
 *
 * ── WHY AN ALLOW-LIST PER KIND, NEVER `mime.startsWith('image/')` ──────────────
 * A prefix test ships a bug on day one. Meta REJECTS `image/gif` as an image — a GIF has
 * to go as a document, where it arrives as a downloadable file rather than an error — and
 * `image/webp` is sticker-only, with its own caps and a square-ish aspect requirement no
 * ordinary attachment satisfies. Video is mp4 and 3gp only. Everything outside these lists
 * is a DOCUMENT, which is what makes "attach any file" true rather than aspirational:
 * documents accept every type, so the fallback is always deliverable.
 *
 * ⚠️ `mime` is CLIENT-SUPPLIED — multer copies whatever the browser declared — so a
 * special-cased kind has to be CORROBORATED by the filename, not merely un-contradicted by
 * it: `payload.exe` announced as `image/png` is demoted to a document rather than uploaded
 * to Meta as an image. That is why an UNRECOGNISED extension demotes as well as a
 * conflicting one. Demotion is never an error — plenty of harmless files carry a vague
 * type, and they all still arrive, just as documents.
 */
export type WhatsAppMediaKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker';

/** Meta's per-kind ceilings. A file over its kind's cap is rejected before any upload. */
export const WHATSAPP_MEDIA_MAX_BYTES: Record<WhatsAppMediaKind, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  // The one that makes "any file" worth having. Also the reason the upload streams from
  // disk rather than a Buffer — see `uploadMediaFromFile`.
  document: 100 * 1024 * 1024,
  sticker: 500 * 1024,
};

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png']);
const VIDEO_MIMES = new Set(['video/mp4', 'video/3gpp']);
const AUDIO_MIMES = new Set([
  'audio/aac',
  'audio/amr',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);

/** What each extension really is, for the agreement check above. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.3gp': 'video/3gpp',
  '.3gpp': 'video/3gpp',
  '.aac': 'audio/aac',
  '.amr': 'audio/amr',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
};

function extensionOf(filename: string | null | undefined): string {
  const name = filename ?? '';
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot).toLowerCase();
}

export function whatsappMediaKind(
  mime: string | null | undefined,
  filename: string | null | undefined,
): WhatsAppMediaKind {
  const base = baseMime(mime);
  if (!base) return 'document';

  // The declared type must be CORROBORATED by the filename, not merely un-contradicted by
  // it. An extension this table has no entry for — `.exe` announced as `image/png` — is
  // exactly the case worth catching, so an unrecognised extension demotes too. A file with
  // no extension at all has nothing to disagree with and keeps its declared type.
  const ext = extensionOf(filename);
  if (ext && MIME_BY_EXTENSION[ext] !== base) return 'document';

  if (IMAGE_MIMES.has(base)) return 'image';
  if (VIDEO_MIMES.has(base)) return 'video';
  if (AUDIO_MIMES.has(base)) return 'audio';
  return 'document';
}

/**
 * Can this kind carry a caption?
 *
 * Image, video and document only. Meta ignores a caption on audio and stickers, so the
 * composer disables the field rather than letting somebody type a sentence that silently
 * never arrives.
 */
export function whatsappAcceptsCaption(kind: WhatsAppMediaKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'document';
}

/** Meta's caption ceiling — a THIRD of the 4096 a plain text message allows. */
export const WHATSAPP_MAX_CAPTION = 1024;

/** `audio/ogg; codecs=opus` -> `audio/ogg`. */
export function baseMime(mime: string | null | undefined): string | null {
  const base = mime?.split(';')[0]?.trim().toLowerCase();
  return base ? base : null;
}

export function extensionForMime(mime: string | null | undefined): string {
  return EXTENSIONS[baseMime(mime) ?? ''] ?? '';
}

/** What a download is called when the sender gave it no name. */
export function mediaFilename(
  type: string,
  filename: string | null,
  messageId: number,
  mime: string | null,
): string {
  if (filename) return filename;
  const label = type === 'audio' ? 'voice' : type;
  return `whatsapp-${label}-${messageId}${extensionForMime(mime)}`;
}

/**
 * The only format WhatsApp renders as a VOICE NOTE is Opus in Ogg; mp3 or m4a arrives as
 * an audio file. A separate constant from `TELEPHONY_MP3_ARGS` / `TRANSCRIBE_MP3_ARGS`:
 * those are load-bearing for their own consumers, and retuning a shared constant for a
 * new one is how the first one silently breaks.
 */
export const WHATSAPP_VOICE_ARGS = [
  '-vn',
  '-ac',
  '1',
  '-ar',
  '48000',
  '-c:a',
  'libopus',
  '-b:a',
  '32k',
  '-f',
  'ogg',
];

/** What the browser plays: mp3 works everywhere, Ogg/Opus does not (Safari). */
export const WHATSAPP_PLAYBACK_MP3_ARGS = [
  '-vn',
  '-ac',
  '1',
  '-c:a',
  'libmp3lame',
  '-q:a',
  '5',
  '-f',
  'mp3',
];

// ── Generating a number from a support number ────────────────────────────────

/**
 * `+15145551234` -> `{ cc: '1', number: '5145551234' }`, the shape
 * `POST /{waba}/phone_numbers` takes. Null for anything else: support numbers are only
 * ever bought in Canada and the US, both +1, so a non-NANP number is a data problem to
 * surface rather than a country code to guess at.
 */
export function splitNanpNumber(
  e164: string | null | undefined,
): { cc: string; number: string } | null {
  const match = /^\+1(\d{10})$/.exec((e164 ?? '').trim());
  return match ? { cc: '1', number: match[1] } : null;
}

/**
 * The verification code from Meta's SMS ("Your WhatsApp Business code 123-456…"), or null.
 *
 * Two conditions, both load-bearing: the text must mention WhatsApp, or a client texting
 * "call me at 514-555" would be read as a code; and exactly six digits, hyphen optional,
 * with no digit either side — a phone number or a 7-digit reference must not match.
 */
export function extractWhatsAppCode(body: unknown): string | null {
  if (typeof body !== 'string' || !/whats\s?app/i.test(body)) return null;
  const match = /(?<!\d)(\d{3})[-\s]?(\d{3})(?!\d)/.exec(body);
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * Meta errors for which asking again BY VOICE is pointless.
 *
 * A voice call is a different DELIVERY path, so it is worth retrying when a text could not
 * be delivered. It is worth nothing when the request itself was refused — a revoked token,
 * a throttle, or an attempt ceiling applies to both methods equally, and a second request
 * spends a second attempt against limits that are already the problem.
 */
const VOICE_RETRY_POINTLESS = new Set([
  // The token is revoked or expired.
  190,
  // Too many registration attempts — Meta's 10-per-72h ceiling.
  133016,
  // Rate limited.
  131048, 80007, 4,
  // The number is already on this WABA: not a delivery failure at all.
  2388012,
]);

/** Should a failed `request_code` be retried as a voice call? */
export function shouldRetryByVoice(code: number | null): boolean {
  return code === null || !VOICE_RETRY_POINTLESS.has(code);
}

/** Spoken digits, as a transcript renders them. `oh` is how people say a zero aloud. */
const SPOKEN_DIGITS: Record<string, string> = {
  zero: '0',
  oh: '0',
  o: '0',
  nought: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};

/** How many digits a WhatsApp verification code has. */
const CODE_LENGTH = 6;

/**
 * The six-digit code out of a TRANSCRIPT of Meta's verification call.
 *
 * ── WHY NOT `extractWhatsAppCode` ──────────────────────────────────────────────
 * That one reads a TEXT MESSAGE, where Meta controls the exact wording, and it leans on
 * two things a transcript does not provide. It demands the literal word "WhatsApp", which
 * speech-to-text mangles ("what's app", "whatsapp" as two words, or dropped entirely under
 * a robotic voice); and it demands `\d{3}[-\s]?\d{3}`, whereas a code read aloud comes
 * back as "4 9 3 0 2 1", "four nine three zero two one", or a mixture of the two.
 *
 * So this one reads digits wherever it can — numerals or words — and takes the first run
 * of exactly six. It does NOT require any surrounding wording, because it is only ever
 * called for a recording made on a call that arrived while that company was in
 * `PENDING_CODE` with `codeMethod: 'VOICE'`; the state is the proof of what the audio is,
 * and the transcript only has to yield the number.
 *
 * ⚠️ It FAILS CLOSED, three ways. A run that is not exactly six digits is rejected rather
 * than truncated (a phone number the robot also reads out must not become a code); only
 * true digit words are accepted, never homophones like "for", "to", "ate" or "won"; and
 * if two DIFFERENT six-digit numbers appear, it returns null rather than picking one.
 * `register` is capped at 10 attempts per 72 hours (Meta error 133016), so a wrong guess
 * is expensive, while a null simply lets the sweep time out and ask for a new code.
 */
export function extractSpokenCode(transcript: unknown): string | null {
  if (typeof transcript !== 'string') return null;

  // Every token that carries a digit, in order, with everything else dropped. A numeral
  // group contributes all of its digits ("493021" -> 6), a word contributes one.
  const runs: string[] = [];
  let current = '';
  for (const token of transcript.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!token) continue;
    if (/^\d+$/.test(token)) {
      current += token;
      continue;
    }
    const spoken = SPOKEN_DIGITS[token];
    if (spoken) {
      current += spoken;
      continue;
    }
    // A word that is not a digit ends the run: "your code is 493021 for WhatsApp" must
    // not join the 493021 to anything read out later.
    if (current) runs.push(current);
    current = '';
  }
  if (current) runs.push(current);

  // Exactly six. A shorter run is a fragment and a longer one is something else entirely
  // (a phone number, an account reference) — neither is a code, and a long run is
  // REJECTED rather than trimmed to its first six digits.
  const candidates = runs.filter((run) => run.length === CODE_LENGTH);
  if (candidates.length === 0) return null;

  // ⚠️ Every candidate must agree. Meta's robot reads the code TWICE, so agreement is
  // the confirmation that the transcript was heard correctly — and disagreement means
  // something else in the audio also looked like a six-digit number, which is exactly
  // the case where guessing costs one of the ten register attempts Meta allows per 72
  // hours. Two different readings are not a reason to pick one.
  return candidates.every((c) => c === candidates[0]) ? candidates[0] : null;
}

/**
 * What a generated number is displayed as — the company's own name, trimmed and
 * whitespace-collapsed. The cap is a safety net, not Meta's documented limit.
 */
export const MAX_DISPLAY_NAME = 64;

export function toDisplayName(businessName: string): string {
  return businessName
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME)
    .trim();
}

/**
 * Graph error codes a member of staff can act on, in words they can act on. Anything
 * else passes Meta's own message through.
 */
export function friendlyGraphMessage(
  code: number | null,
  fallback: string,
): string {
  // Meta's own code for this one is undocumented, so it is matched on its wording.
  if (/maximum number of phone numbers/i.test(fallback)) {
    return "The firm's WhatsApp account already holds as many numbers as Meta allows. It stays at 2 until Meta approves the business verification.";
  }
  switch (code) {
    case 2388012:
      return "This number is already on the firm's WhatsApp account.";
    // ⚠️ NOT "already verified", which is what this said until the live logs contradicted
    // it. 136024 is a GENERIC request_code failure: the same code came back as both
    // "Number unreachable. Check number or try an alternate verification method." and
    // "Please try again in some time." on the same number, minutes apart. Reading it as
    // "already verified" is what sent `generate` on to `register` with no code, so the
    // card showed "Phone number is not verified through sms or voice" — an error about a
    // step that had never run. Meta's own detail is appended, because "unreachable" and
    // "try again shortly" call for completely different responses.
    case 136024:
      return `WhatsApp could not send a verification code to this number. ${fallback}`;
    case 133016:
      return 'WhatsApp blocked registering this number after too many attempts. Try again in 72 hours.';
    case 133006:
      return 'WhatsApp has not verified this number yet. Try again to send a new code.';
    case 131047:
      return 'The 24-hour reply window is closed. WhatsApp only allows an approved template until the customer writes again.';
    case 131030:
      return "This number is not on the WhatsApp test number's allowed recipients. Add it in the Meta dashboard, or connect a production number.";
    case 131026:
      return 'WhatsApp could not deliver this message. The recipient may not have WhatsApp.';
    case 133010:
      return 'This WhatsApp number is not registered yet. Finish registering it in WhatsApp Manager.';
    case 190:
      return 'The WhatsApp connection has expired or was revoked. Reconnect WhatsApp for this company.';
    default:
      return fallback;
  }
}

/** A human label for a message with no text — the inbox row, the bell, the print view. */
export function whatsappPreview(
  type: string,
  body: string | null,
  isVoice: boolean,
): string {
  if (body) return body;
  switch (type) {
    case 'audio':
      return isVoice ? 'Voice message' : 'Audio';
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'document':
      return 'Document';
    case 'sticker':
      return 'Sticker';
    case 'location':
      return 'Location';
    case 'contacts':
      return 'Contact';
    case 'unsupported':
      return 'Unsupported message';
    default:
      return '(no text)';
  }
}

// ── Message templates ─────────────────────────────────────────────────────────

/** A template as Meta returns it from `/{waba}/message_templates`. */
export interface RawTemplate {
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  components?: { type?: string; text?: string }[];
}

/** `{{1}}`, `{{ 2 }}` — Meta writes them positionally, one-based. */
const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;

/**
 * How many distinct `{{n}}` placeholders a body carries.
 *
 * The COUNT is the highest index, not the number of occurrences: a body may repeat
 * `{{1}}`, and Meta still expects exactly one parameter for it. Counting occurrences
 * would send two and be rejected.
 */
export function countTemplateVariables(body: string): number {
  let highest = 0;
  for (const m of body.matchAll(PLACEHOLDER)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > highest) highest = n;
  }
  return highest;
}

/** Flatten one raw template, or null when it has no usable body. */
export function toTemplate(raw: RawTemplate): WhatsAppTemplateDto | null {
  const name = raw.name?.trim();
  const language = raw.language?.trim();
  if (!name || !language) return null;
  const body = raw.components?.find(
    (c) => c.type?.toUpperCase() === 'BODY',
  )?.text;
  if (!body) return null;
  return {
    name,
    language,
    category: raw.category ?? 'UTILITY',
    body,
    variableCount: countTemplateVariables(body),
  };
}

/**
 * The template body with its placeholders filled — what gets STORED as the message body
 * and read back in the inbox and the thread.
 *
 * ⚠️ This is the only part of template sending that can be silently wrong: Meta sends the
 * real message from its own copy, so a mistake here is invisible at send time and shows up
 * later as history that does not match what the customer received.
 *
 * A missing variable is left as its own placeholder rather than blanked, so a gap is
 * visible rather than reading as a sentence somebody meant to write.
 */
export function renderTemplateBody(
  body: string,
  variables: readonly string[],
): string {
  return body.replace(PLACEHOLDER, (whole, digits: string) => {
    const value = variables[Number(digits) - 1];
    return value === undefined || value === '' ? whole : value;
  });
}

/** The `components` array Meta wants for a body-only template send. */
export function templateComponents(variables: readonly string[]): unknown[] {
  if (variables.length === 0) return [];
  return [
    {
      type: 'body',
      parameters: variables.map((text) => ({ type: 'text', text })),
    },
  ];
}
