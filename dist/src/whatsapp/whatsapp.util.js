"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_DISPLAY_NAME = exports.WHATSAPP_PLAYBACK_MP3_ARGS = exports.WHATSAPP_VOICE_ARGS = exports.WHATSAPP_MAX_CAPTION = exports.WHATSAPP_MEDIA_MAX_BYTES = exports.REPLY_WINDOW_MS = exports.WHATSAPP_ITEM_PREFIX = void 0;
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
exports.whatsappMediaKind = whatsappMediaKind;
exports.whatsappAcceptsCaption = whatsappAcceptsCaption;
exports.baseMime = baseMime;
exports.extensionForMime = extensionForMime;
exports.mediaFilename = mediaFilename;
exports.splitNanpNumber = splitNanpNumber;
exports.extractWhatsAppCode = extractWhatsAppCode;
exports.shouldRetryByVoice = shouldRetryByVoice;
exports.extractSpokenCode = extractSpokenCode;
exports.toDisplayName = toDisplayName;
exports.friendlyGraphMessage = friendlyGraphMessage;
exports.whatsappPreview = whatsappPreview;
exports.countTemplateVariables = countTemplateVariables;
exports.toTemplate = toTemplate;
exports.renderTemplateBody = renderTemplateBody;
exports.templateComponents = templateComponents;
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
exports.WHATSAPP_MEDIA_MAX_BYTES = {
    image: 5 * 1024 * 1024,
    video: 16 * 1024 * 1024,
    audio: 16 * 1024 * 1024,
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
const MIME_BY_EXTENSION = {
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
function extensionOf(filename) {
    const name = filename ?? '';
    const dot = name.lastIndexOf('.');
    return dot === -1 ? '' : name.slice(dot).toLowerCase();
}
function whatsappMediaKind(mime, filename) {
    const base = baseMime(mime);
    if (!base)
        return 'document';
    const ext = extensionOf(filename);
    if (ext && MIME_BY_EXTENSION[ext] !== base)
        return 'document';
    if (IMAGE_MIMES.has(base))
        return 'image';
    if (VIDEO_MIMES.has(base))
        return 'video';
    if (AUDIO_MIMES.has(base))
        return 'audio';
    return 'document';
}
function whatsappAcceptsCaption(kind) {
    return kind === 'image' || kind === 'video' || kind === 'document';
}
exports.WHATSAPP_MAX_CAPTION = 1024;
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
const VOICE_RETRY_POINTLESS = new Set([
    190,
    133016,
    131048, 80007, 4,
    2388012,
]);
function shouldRetryByVoice(code) {
    return code === null || !VOICE_RETRY_POINTLESS.has(code);
}
const SPOKEN_DIGITS = {
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
const CODE_LENGTH = 6;
function extractSpokenCode(transcript) {
    if (typeof transcript !== 'string')
        return null;
    const runs = [];
    let current = '';
    for (const token of transcript.toLowerCase().split(/[^a-z0-9]+/)) {
        if (!token)
            continue;
        if (/^\d+$/.test(token)) {
            current += token;
            continue;
        }
        const spoken = SPOKEN_DIGITS[token];
        if (spoken) {
            current += spoken;
            continue;
        }
        if (current)
            runs.push(current);
        current = '';
    }
    if (current)
        runs.push(current);
    const candidates = runs.filter((run) => run.length === CODE_LENGTH);
    if (candidates.length === 0)
        return null;
    return candidates.every((c) => c === candidates[0]) ? candidates[0] : null;
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
const PLACEHOLDER = /\{\{\s*(\d+)\s*\}\}/g;
function countTemplateVariables(body) {
    let highest = 0;
    for (const m of body.matchAll(PLACEHOLDER)) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > highest)
            highest = n;
    }
    return highest;
}
function toTemplate(raw) {
    const name = raw.name?.trim();
    const language = raw.language?.trim();
    if (!name || !language)
        return null;
    const body = raw.components?.find((c) => c.type?.toUpperCase() === 'BODY')?.text;
    if (!body)
        return null;
    return {
        name,
        language,
        category: raw.category ?? 'UTILITY',
        body,
        variableCount: countTemplateVariables(body),
    };
}
function renderTemplateBody(body, variables) {
    return body.replace(PLACEHOLDER, (whole, digits) => {
        const value = variables[Number(digits) - 1];
        return value === undefined || value === '' ? whole : value;
    });
}
function templateComponents(variables) {
    if (variables.length === 0)
        return [];
    return [
        {
            type: 'body',
            parameters: variables.map((text) => ({ type: 'text', text })),
        },
    ];
}
//# sourceMappingURL=whatsapp.util.js.map