"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DISPLAY_NAME = exports.WHATSAPP_PLAYBACK_MP3_ARGS = exports.WHATSAPP_VOICE_ARGS = exports.REPLY_WINDOW_MS = exports.WHATSAPP_ITEM_PREFIX = void 0;
exports.whatsappItemId = whatsappItemId;
exports.whatsappConfig = whatsappConfig;
exports.verifyMetaSignature = verifyMetaSignature;
exports.normalizeWaId = normalizeWaId;
exports.parseWaTimestamp = parseWaTimestamp;
exports.windowOpenUntil = windowOpenUntil;
exports.isWindowOpen = isWindowOpen;
exports.nextDeliveryStatus = nextDeliveryStatus;
exports.parseWebhook = parseWebhook;
exports.graphErrorOf = graphErrorOf;
exports.baseMime = baseMime;
exports.extensionForMime = extensionForMime;
exports.mediaFilename = mediaFilename;
exports.splitNanpNumber = splitNanpNumber;
exports.extractWhatsAppCode = extractWhatsAppCode;
exports.toDisplayName = toDisplayName;
exports.friendlyGraphMessage = friendlyGraphMessage;
exports.whatsappPreview = whatsappPreview;
const crypto_1 = require("crypto");
exports.WHATSAPP_ITEM_PREFIX = 'wa:';
function whatsappItemId(messageId) {
    return `${exports.WHATSAPP_ITEM_PREFIX}${messageId}`;
}
function pick(env, key) {
    const value = env[key]?.trim();
    return value ? value : null;
}
function whatsappConfig(env) {
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
function verifyMetaSignature(rawBody, header, secret) {
    if (!secret || !rawBody || !header)
        return false;
    const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
    if (!match)
        return false;
    const expected = (0, crypto_1.createHmac)('sha256', secret).update(rawBody).digest();
    const given = Buffer.from(match[1], 'hex');
    return given.length === expected.length && (0, crypto_1.timingSafeEqual)(given, expected);
}
function normalizeWaId(raw) {
    if (typeof raw !== 'string' && typeof raw !== 'number')
        return null;
    const text = String(raw).trim();
    if (!/^\+?[\d\s().-]+$/.test(text))
        return null;
    const digits = text.replace(/\D/g, '');
    return /^\d{6,15}$/.test(digits) ? digits : null;
}
function parseWaTimestamp(raw, fallback) {
    const seconds = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(seconds) || seconds <= 0)
        return fallback;
    return new Date(seconds * 1000);
}
exports.REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
function windowOpenUntil(lastInboundAt) {
    return lastInboundAt
        ? new Date(lastInboundAt.getTime() + exports.REPLY_WINDOW_MS)
        : null;
}
function isWindowOpen(lastInboundAt, now) {
    const until = windowOpenUntil(lastInboundAt);
    return until !== null && now.getTime() < until.getTime();
}
const STATUS_RANK = {
    sent: 1,
    delivered: 2,
    read: 3,
    failed: 4,
};
function nextDeliveryStatus(current, incoming) {
    if (current === 'failed')
        return 'failed';
    const currentRank = current && current in STATUS_RANK
        ? STATUS_RANK[current]
        : 0;
    return STATUS_RANK[incoming] > currentRank
        ? incoming
        : current;
}
function obj(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function arr(value) {
    return Array.isArray(value) ? value : [];
}
function str(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
const DELIVERY_STATUSES = new Set([
    'sent',
    'delivered',
    'read',
    'failed',
]);
function parseMessage(raw, profiles, now) {
    const m = obj(raw);
    const wamid = str(m?.id);
    const from = normalizeWaId(m?.from);
    if (!m || !wamid || !from)
        return null;
    const base = {
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
            type: type,
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
        const coords = typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number'
            ? `${loc.latitude}, ${loc.longitude}`
            : null;
        return { ...base, type: 'location', body: label || coords };
    }
    if (type === 'contacts') {
        const names = arr(m.contacts)
            .map((c) => str(obj(obj(c)?.name)?.formatted_name))
            .filter((n) => n !== null);
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
        const title = str(obj(interactive?.button_reply)?.title) ??
            str(obj(interactive?.list_reply)?.title);
        return { ...base, type: 'interactive', body: title };
    }
    if (type === 'button') {
        return { ...base, type: 'button', body: str(obj(m.button)?.text) };
    }
    return base;
}
function parseStatus(raw) {
    const s = obj(raw);
    const wamid = str(s?.id);
    const status = str(s?.status);
    if (!s || !wamid || !status || !DELIVERY_STATUSES.has(status))
        return null;
    const code = obj(arr(s.errors)[0])?.code;
    return {
        wamid,
        status: status,
        errorCode: typeof code === 'number' || typeof code === 'string'
            ? String(code)
            : null,
    };
}
function parseWebhook(body, now = new Date()) {
    const root = obj(body);
    if (root?.object !== 'whatsapp_business_account')
        return [];
    const out = [];
    for (const entry of arr(root.entry)) {
        for (const rawChange of arr(obj(entry)?.changes)) {
            const change = obj(rawChange);
            if (change?.field !== 'messages')
                continue;
            const value = obj(change.value);
            const phoneNumberId = str(obj(value?.metadata)?.phone_number_id);
            if (!value || !phoneNumberId)
                continue;
            const profiles = new Map();
            for (const c of arr(value.contacts)) {
                const waId = normalizeWaId(obj(c)?.wa_id);
                const name = str(obj(obj(c)?.profile)?.name);
                if (waId && name)
                    profiles.set(waId, name);
            }
            out.push({
                phoneNumberId,
                messages: arr(value.messages)
                    .map((m) => parseMessage(m, profiles, now))
                    .filter((m) => m !== null),
                statuses: arr(value.statuses)
                    .map(parseStatus)
                    .filter((s) => s !== null),
            });
        }
    }
    return out;
}
function graphErrorOf(data) {
    const error = obj(obj(data)?.error);
    if (!error)
        return null;
    return {
        message: str(error.error_user_msg) ?? str(error.message) ?? 'WhatsApp error',
        code: typeof error.code === 'number' ? error.code : null,
        subcode: typeof error.error_subcode === 'number' ? error.error_subcode : null,
    };
}
const EXTENSIONS = {
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
function baseMime(mime) {
    const base = mime?.split(';')[0]?.trim().toLowerCase();
    return base ? base : null;
}
function extensionForMime(mime) {
    return EXTENSIONS[baseMime(mime) ?? ''] ?? '';
}
function mediaFilename(type, filename, messageId, mime) {
    if (filename)
        return filename;
    const label = type === 'audio' ? 'voice' : type;
    return `whatsapp-${label}-${messageId}${extensionForMime(mime)}`;
}
exports.WHATSAPP_VOICE_ARGS = [
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
exports.WHATSAPP_PLAYBACK_MP3_ARGS = [
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
function splitNanpNumber(e164) {
    const match = /^\+1(\d{10})$/.exec((e164 ?? '').trim());
    return match ? { cc: '1', number: match[1] } : null;
}
function extractWhatsAppCode(body) {
    if (typeof body !== 'string' || !/whats\s?app/i.test(body))
        return null;
    const match = /(?<!\d)(\d{3})[-\s]?(\d{3})(?!\d)/.exec(body);
    return match ? `${match[1]}${match[2]}` : null;
}
exports.MAX_DISPLAY_NAME = 64;
function toDisplayName(businessName) {
    return businessName
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, exports.MAX_DISPLAY_NAME)
        .trim();
}
function friendlyGraphMessage(code, fallback) {
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
function whatsappPreview(type, body, isVoice) {
    if (body)
        return body;
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
//# sourceMappingURL=whatsapp.util.js.map