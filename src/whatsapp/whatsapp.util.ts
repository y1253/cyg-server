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
    case 136024:
      return 'This number is already verified with WhatsApp.';
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
