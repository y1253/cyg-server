"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var GmailService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const promises_1 = require("fs/promises");
const child_process_1 = require("child_process");
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const googleapis_1 = require("googleapis");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const encode_header_js_1 = require("./encode-header.js");
const attachment_name_util_js_1 = require("../communications/attachment-name.util.js");
const crypto_util_js_1 = require("../communications/crypto.util.js");
const message_state_service_js_1 = require("../communications/message-state.service.js");
const company_access_util_js_1 = require("../communications/company-access.util.js");
const pool_util_js_1 = require("../communications/pool.util.js");
const drive_upload_js_1 = require("./drive-upload.js");
const link_attachments_util_js_1 = require("../communications/link-attachments.util.js");
const inline_attachments_util_js_1 = require("../communications/inline-attachments.util.js");
const outbound_uploads_js_1 = require("../communications/outbound-uploads.js");
const send_error_util_js_1 = require("../communications/send-error.util.js");
const preview_util_js_1 = require("../communications/preview.util.js");
const CHAT_SEND_SCOPES = [
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/chat.messages.create',
];
function grantsChatSend(scope) {
    const tokens = (scope ?? '').split(/\s+/);
    return CHAT_SEND_SCOPES.some((s) => tokens.includes(s));
}
const SPACES_MANAGE_SCOPES = [
    'https://www.googleapis.com/auth/chat.spaces',
    'https://www.googleapis.com/auth/chat.spaces.create',
];
function grantsSpacesSetup(scope) {
    const tokens = (scope ?? '').split(/\s+/);
    return SPACES_MANAGE_SCOPES.some((s) => tokens.includes(s));
}
const PEOPLE_SCOPES = [
    'https://www.googleapis.com/auth/directory.readonly',
    'https://www.googleapis.com/auth/contacts.readonly',
    'https://www.googleapis.com/auth/contacts.other.readonly',
];
function grantsPeopleScopes(scope) {
    const tokens = (scope ?? '').split(/\s+/);
    return PEOPLE_SCOPES.some((s) => tokens.includes(s));
}
function parseAddress(token) {
    const t = token.trim();
    if (!t)
        return null;
    const angle = t.match(/<([^>]+)>/);
    const email = (angle ? angle[1] : t).trim().toLowerCase();
    if (!email.includes('@') || /\s/.test(email))
        return null;
    let name = angle ? t.slice(0, angle.index).trim() : '';
    name = name.replace(/^"(.*)"$/, '$1').trim();
    return { email, name };
}
function headerValue(headers, name) {
    const wanted = name.toLowerCase();
    return ((headers ?? []).find((x) => (x.name ?? '').toLowerCase() === wanted)
        ?.value ?? '');
}
function getCallbackUrl() {
    return `${process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'}/api/gmail/callback`;
}
function makeOAuth2Client() {
    return new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_API_SECRET, getCallbackUrl());
}
const SEND_TOKEN_MIN_MS = 10 * 60 * 1000;
function generateState(companyId, userId) {
    const payload = Buffer.from(JSON.stringify({ companyId, userId, ts: Date.now() })).toString('base64url');
    const sig = crypto
        .createHmac('sha256', process.env.JWT_SECRET ?? 'secret')
        .update(payload)
        .digest('hex');
    return `${payload}.${sig}`;
}
function verifyState(state) {
    const dotIdx = state.lastIndexOf('.');
    if (dotIdx === -1)
        throw new common_1.UnauthorizedException('Invalid state');
    const payload = state.slice(0, dotIdx);
    const sig = state.slice(dotIdx + 1);
    const expected = crypto
        .createHmac('sha256', process.env.JWT_SECRET ?? 'secret')
        .update(payload)
        .digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length ||
        !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new common_1.UnauthorizedException('Invalid state signature');
    }
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - parsed.ts > 10 * 60 * 1000) {
        throw new common_1.UnauthorizedException('State expired');
    }
    return { companyId: parsed.companyId, userId: parsed.userId };
}
function decodeIdTokenSub(idToken) {
    if (!idToken)
        return null;
    try {
        const payloadSeg = idToken.split('.')[1];
        if (!payloadSeg)
            return null;
        const json = Buffer.from(payloadSeg, 'base64url').toString('utf8');
        const payload = JSON.parse(json);
        return payload.sub ?? null;
    }
    catch {
        return null;
    }
}
function extractPart(payload, mimeType) {
    if (!payload)
        return null;
    if (payload.mimeType === mimeType && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf8');
    }
    if (payload.parts) {
        for (const part of payload.parts) {
            const found = extractPart(part, mimeType);
            if (found)
                return found;
        }
    }
    return null;
}
function extractAttachments(payload, referencedCids) {
    const out = [];
    const walk = (part) => {
        if (!part)
            return;
        const attachmentId = part.body?.attachmentId ?? undefined;
        if (part.filename && attachmentId) {
            const header = (name) => part.headers?.find((h) => h.name?.toLowerCase() === name)?.value ??
                null;
            const contentId = (0, inline_attachments_util_js_1.normalizeContentId)(header('content-id'));
            out.push({
                filename: part.filename,
                mimeType: part.mimeType ?? 'application/octet-stream',
                size: part.body?.size ?? 0,
                attachmentId,
                contentId,
                isInline: (0, inline_attachments_util_js_1.isBodyEmbedded)(contentId, referencedCids),
            });
        }
        for (const child of part.parts ?? [])
            walk(child);
    };
    walk(payload);
    return out;
}
function mapChatAttachments(attachment) {
    return (attachment ?? []).map((a) => ({
        name: a.name ?? '',
        contentName: a.contentName ?? 'attachment',
        contentType: a.contentType ?? 'application/octet-stream',
        resourceName: a.attachmentDataRef?.resourceName ?? null,
        driveFileId: a.driveDataRef?.driveFileId ?? null,
        thumbnailUri: a.thumbnailUri ?? null,
        downloadUri: a.downloadUri ?? null,
        source: a.source ?? null,
    }));
}
function chatSenderLabel(sender, resolved, memberDisplayNames) {
    const person = sender?.name ? resolved.get(sender.name) : undefined;
    return (person?.email ||
        person?.displayName ||
        sender?.displayName ||
        (sender?.name ? memberDisplayNames.get(sender.name) : undefined) ||
        'Unknown');
}
let GmailService = class GmailService {
    static { GmailService_1 = this; }
    prisma;
    state;
    logger = new common_1.Logger(GmailService_1.name);
    providerKind = 'GOOGLE';
    sseClients = new Map();
    static SENDER_TTL_MS = 24 * 60 * 60 * 1000;
    static SENDER_MISS_TTL_MS = 60 * 60 * 1000;
    static PEOPLE_RETRY_MS = 5 * 60 * 1000;
    senderCache = new Map();
    senderLookupWarned = new Set();
    senderFailure = new Map();
    memberListWarned = new Set();
    directoryCache = new Map();
    static MESSAGE_TTL_MS = 6 * 60 * 60 * 1000;
    static MESSAGE_CACHE_MAX = 5000;
    messageCache = new Map();
    static UNREAD_TTL_MS = 10 * 1000;
    static UNREAD_MAX_PAGES = 4;
    unreadCache = new Map();
    unreadInFlight = new Map();
    static CHAT_META_TTL_MS = 5 * 60 * 1000;
    spacesCache = new Map();
    membersCache = new Map();
    noOrderBySpaces = new Map();
    static ORDER_BY_TTL_MS = 24 * 60 * 60 * 1000;
    constructor(prisma, state) {
        this.prisma = prisma;
        this.state = state;
    }
    generateAuthUrl(companyId, userId) {
        const oauth2Client = makeOAuth2Client();
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            prompt: 'consent',
            include_granted_scopes: true,
            scope: [
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/userinfo.email',
                'openid',
                'https://www.googleapis.com/auth/chat.spaces',
                'https://www.googleapis.com/auth/chat.memberships.readonly',
                'https://www.googleapis.com/auth/chat.messages',
                'https://www.googleapis.com/auth/directory.readonly',
                'https://www.googleapis.com/auth/contacts.readonly',
                'https://www.googleapis.com/auth/contacts.other.readonly',
                'https://www.googleapis.com/auth/drive.file',
            ],
            state: generateState(companyId, userId),
        });
        return { authUrl };
    }
    async handleCallback(code, state) {
        const { companyId } = verifyState(state);
        const oauth2Client = makeOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.access_token || !tokens.refresh_token) {
            throw new common_1.BadRequestException('Missing tokens from Google');
        }
        oauth2Client.setCredentials(tokens);
        const grantedScopes = (tokens.scope ?? '').split(' ');
        const hasChatMessages = grantedScopes.some((s) => s.includes('chat.messages'));
        console.log('[Gmail] OAuth callback — granted scopes:', tokens.scope);
        if (!hasChatMessages) {
            console.warn('[Gmail] chat.messages scope NOT granted. Chat replies will fail. Add it to the OAuth consent screen in Google Cloud Console.');
        }
        const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: userInfo } = await oauth2.userinfo.get();
        const gmailAddress = userInfo.email;
        if (!gmailAddress)
            throw new common_1.BadRequestException('Could not read Gmail address');
        const chatUserId = decodeIdTokenSub(tokens.id_token) ?? userInfo.id ?? null;
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        const encAccessToken = (0, crypto_util_js_1.encrypt)(tokens.access_token, encKey);
        const encRefreshToken = (0, crypto_util_js_1.encrypt)(tokens.refresh_token, encKey);
        const tokenExpiry = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);
        await this.prisma.gmailAccount.upsert({
            where: { companyId },
            create: {
                companyId,
                gmailAddress,
                accessToken: encAccessToken,
                refreshToken: encRefreshToken,
                tokenExpiry,
                chatUserId,
                scope: tokens.scope ?? null,
            },
            update: {
                gmailAddress,
                accessToken: encAccessToken,
                refreshToken: encRefreshToken,
                tokenExpiry,
                chatUserId,
                scope: tokens.scope ?? null,
            },
        });
        this.clearSenderState(companyId);
        void this.startWatch(companyId).catch(() => undefined);
        void this.markExistingAsCompletedOnConnect(companyId, oauth2Client).catch(() => undefined);
        return companyId;
    }
    async startWatch(companyId) {
        const topicName = process.env.PUBSUB_TOPIC_NAME;
        if (!topicName)
            return;
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.watch({
            userId: 'me',
            requestBody: { topicName, labelIds: ['INBOX'] },
        });
        const historyId = res.data.historyId ? BigInt(res.data.historyId) : null;
        const watchExpiry = res.data.expiration
            ? new Date(Number(res.data.expiration))
            : null;
        await this.prisma.gmailAccount.update({
            where: { companyId },
            data: { lastHistoryId: historyId, watchExpiry },
        });
    }
    async renewExpiringWatches() {
        const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);
        const accounts = await this.prisma.gmailAccount.findMany({
            where: { watchExpiry: { lte: threshold } },
        });
        for (const acc of accounts) {
            await this.startWatch(acc.companyId).catch(() => undefined);
        }
    }
    refreshInFlight = new Map();
    async ensureFreshTokens(companyId, minRemainingMs = 60 * 1000) {
        const record = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
        });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected for this company');
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        const accessToken = (0, crypto_util_js_1.decrypt)(record.accessToken, encKey);
        const refreshToken = (0, crypto_util_js_1.decrypt)(record.refreshToken, encKey);
        const oauth2Client = makeOAuth2Client();
        oauth2Client.setCredentials({
            access_token: accessToken,
            refresh_token: refreshToken,
        });
        if (record.tokenExpiry > new Date(Date.now() + minRemainingMs)) {
            return oauth2Client;
        }
        const refreshed = await this.refreshTokens(companyId, refreshToken, encKey);
        return refreshed ?? oauth2Client;
    }
    refreshTokens(companyId, refreshToken, encKey) {
        const existing = this.refreshInFlight.get(companyId);
        if (existing)
            return existing;
        const promise = (async () => {
            const client = makeOAuth2Client();
            client.setCredentials({ refresh_token: refreshToken });
            const { credentials } = await client.refreshAccessToken();
            if (!credentials.access_token)
                return null;
            await this.prisma.gmailAccount.update({
                where: { companyId },
                data: {
                    accessToken: (0, crypto_util_js_1.encrypt)(credentials.access_token, encKey),
                    tokenExpiry: new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000),
                },
            });
            client.setCredentials(credentials);
            return client;
        })().finally(() => this.refreshInFlight.delete(companyId));
        this.refreshInFlight.set(companyId, promise);
        return promise;
    }
    async forceFreshTokens(companyId) {
        const record = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
        });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected for this company');
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        const refreshToken = (0, crypto_util_js_1.decrypt)(record.refreshToken, encKey);
        const refreshed = await this.refreshTokens(companyId, refreshToken, encKey);
        if (refreshed)
            return refreshed;
        const fallback = makeOAuth2Client();
        fallback.setCredentials({
            access_token: (0, crypto_util_js_1.decrypt)(record.accessToken, encKey),
            refresh_token: refreshToken,
        });
        return fallback;
    }
    async getAccount(companyId) {
        const record = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
        });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected');
        return {
            provider: 'GOOGLE',
            emailAddress: record.gmailAddress,
            gmailAddress: record.gmailAddress,
            connectedAt: record.connectedAt,
            hasChatScope: grantsChatSend(record.scope),
            signatureHtml: (await this.buildDefaultSignature(companyId)).html,
        };
    }
    async buildDefaultSignature(companyId) {
        const company = await this.prisma.company.findUnique({
            where: { id: companyId },
            select: {
                businessName: true,
                supportNumber: true,
                billing: { select: { billingEmail: true } },
            },
        });
        const sigEmail = company?.billing?.billingEmail ?? null;
        const plain = [
            company?.businessName ?? '',
            'Accounting Department',
            ...(company?.supportNumber ? [company.supportNumber] : []),
            ...(sigEmail ? [sigEmail] : []),
            '',
            'accounting managed by CYG FINANCE (https://cygfinance.com)',
        ].join('\n');
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = '<div data-cyg-signature="1">' +
            [
                `<div>${esc(company?.businessName ?? '')}</div>`,
                `<div>Accounting Department</div>`,
                ...(company?.supportNumber
                    ? [`<div>${esc(company.supportNumber)}</div>`]
                    : []),
                ...(sigEmail ? [`<div>${esc(sigEmail)}</div>`] : []),
                '<div><br></div>',
                `<div style="font-size:0.85em">accounting managed by <a href="https://cygfinance.com">CYG FINANCE</a></div>`,
            ].join('') +
            '</div>';
        return { plain, html };
    }
    async getEmails(companyId, pageToken, labelIds, q) {
        const startedAt = Date.now();
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const isUncompleted = (labelIds ?? []).includes('UNCOMPLETED');
        const isDrafts = (labelIds ?? []).includes('DRAFT');
        const draftIdByMessage = new Map();
        let msgList;
        let nextPageToken;
        if (isDrafts) {
            const listRes = await gmail.users.drafts.list({
                userId: 'me',
                maxResults: pageToken ? 50 : 25,
                pageToken,
            });
            const drafts = listRes.data.drafts ?? [];
            for (const d of drafts) {
                if (d.id && d.message?.id)
                    draftIdByMessage.set(d.message.id, d.id);
            }
            msgList = drafts.map((d) => ({ id: d.message?.id }));
            nextPageToken = listRes.data.nextPageToken ?? null;
        }
        else if (isUncompleted) {
            const ids = await this.getUncompletedEmailIds(companyId, q);
            const offset = pageToken ? parseInt(pageToken, 10) || 0 : 0;
            const slice = ids.slice(offset, offset + 50);
            msgList = slice.map((id) => ({ id }));
            nextPageToken = offset + 50 < ids.length ? String(offset + 50) : null;
        }
        else {
            const labels = labelIds ?? ['INBOX'];
            const listRes = await gmail.users.messages.list({
                userId: 'me',
                maxResults: pageToken ? 50 : 25,
                pageToken,
                ...(labels.includes('ALL') ? {} : { labelIds: labels }),
                ...(q ? { q } : {}),
            });
            msgList = listRes.data.messages ?? [];
            nextPageToken = listRes.data.nextPageToken ?? null;
        }
        const ids = msgList.map((m) => m.id).filter(Boolean);
        const [hydrated, unread, completedSet, forwardedSet] = await Promise.all([
            this.hydrateEmails(companyId, gmail, ids, isDrafts),
            this.unreadIds(companyId, gmail),
            this.state.getCompletedSet(companyId),
            this.state.getForwardedSet(companyId),
        ]);
        const messages = hydrated.records.map((rec) => ({
            ...rec,
            ...(isDrafts
                ? {
                    id: draftIdByMessage.get(rec.id) ?? rec.id,
                    isRead: true,
                    isCompleted: false,
                    isForwarded: false,
                }
                : {
                    isRead: !unread.has(rec.id),
                    isCompleted: completedSet.has(rec.id),
                    isForwarded: forwardedSet.has(rec.id),
                }),
        }));
        this.logger.log(`emails company=${companyId} ${pageToken ? 'page' : 'head'} ` +
            `rows=${ids.length} ` +
            `cached=${ids.length - hydrated.misses}/${ids.length} ` +
            `${Date.now() - startedAt}ms`);
        return { messages, nextPageToken };
    }
    async hydrateEmails(companyId, gmail, ids, skipCache = false) {
        const now = Date.now();
        const found = new Map();
        const misses = [];
        for (const id of ids) {
            const hit = skipCache
                ? undefined
                : this.messageCache.get(`${companyId}:${id}`);
            if (hit && now - hit.at < GmailService_1.MESSAGE_TTL_MS)
                found.set(id, hit.rec);
            else
                misses.push(id);
        }
        const fetched = await (0, pool_util_js_1.pool)(misses, pool_util_js_1.GMAIL_GET_CONCURRENCY, (id) => gmail.users.messages
            .get({ userId: 'me', id, format: 'full' })
            .then((detail) => {
            const headers = detail.data.payload?.headers ?? [];
            const h = (name) => headerValue(headers, name);
            return {
                id,
                threadId: detail.data.threadId ?? '',
                subject: h('Subject'),
                from: h('From'),
                date: h('Date'),
                snippet: detail.data.snippet ?? '',
                to: h('To'),
                attachments: this.parseNonInlineAttachments(detail.data.payload),
            };
        }));
        for (const rec of fetched) {
            found.set(rec.id, rec);
            if (!skipCache) {
                this.messageCache.set(`${companyId}:${rec.id}`, { at: now, rec });
            }
        }
        this.evictMessageCache();
        return {
            records: ids
                .map((id) => found.get(id))
                .filter((r) => !!r),
            misses: misses.length,
        };
    }
    evictMessageCache() {
        if (this.messageCache.size <= GmailService_1.MESSAGE_CACHE_MAX)
            return;
        const entries = [...this.messageCache.entries()].sort((a, b) => a[1].at - b[1].at);
        const drop = this.messageCache.size - GmailService_1.MESSAGE_CACHE_MAX;
        for (let i = 0; i < drop; i++)
            this.messageCache.delete(entries[i][0]);
    }
    async unreadIds(companyId, gmail) {
        const hit = this.unreadCache.get(companyId);
        if (hit && Date.now() - hit.at < GmailService_1.UNREAD_TTL_MS)
            return hit.ids;
        const existing = this.unreadInFlight.get(companyId);
        if (existing)
            return existing;
        const promise = (async () => {
            const ids = new Set();
            let pageToken;
            let page = 0;
            for (; page < GmailService_1.UNREAD_MAX_PAGES; page++) {
                const res = await gmail.users.messages.list({
                    userId: 'me',
                    labelIds: ['UNREAD'],
                    maxResults: 500,
                    fields: 'messages/id,nextPageToken',
                    ...(pageToken ? { pageToken } : {}),
                });
                for (const m of res.data.messages ?? [])
                    if (m.id)
                        ids.add(m.id);
                pageToken = res.data.nextPageToken ?? undefined;
                if (!pageToken)
                    break;
            }
            if (pageToken)
                this.logger.warn(`unreadIds company=${companyId} truncated at ` +
                    `${GmailService_1.UNREAD_MAX_PAGES * 500} ids`);
            this.unreadCache.set(companyId, { at: Date.now(), ids });
            return ids;
        })().finally(() => this.unreadInFlight.delete(companyId));
        this.unreadInFlight.set(companyId, promise);
        return promise;
    }
    bustUnread(companyId) {
        this.unreadCache.delete(companyId);
    }
    async listSpacesCached(companyId, chat) {
        const hit = this.spacesCache.get(companyId);
        if (hit && Date.now() - hit.at < GmailService_1.CHAT_META_TTL_MS)
            return hit.spaces;
        const res = await chat.spaces.list({ pageSize: 20 });
        const spaces = res.data.spaces ?? [];
        this.spacesCache.set(companyId, { at: Date.now(), spaces });
        return spaces;
    }
    async spaceMembersCached(companyId, chat, spaceName) {
        const key = `${companyId}:${spaceName}`;
        const hit = this.membersCache.get(key);
        if (hit && Date.now() - hit.at < GmailService_1.CHAT_META_TTL_MS)
            return hit.names;
        const res = await chat.spaces.members.list({
            parent: spaceName,
            pageSize: 100,
        });
        const names = new Map();
        for (const m of res.data.memberships ?? [])
            if (m.member?.name && m.member.displayName)
                names.set(m.member.name, m.member.displayName);
        this.membersCache.set(key, { at: Date.now(), names });
        return names;
    }
    spaceRejectsOrderBy(spaceName) {
        const at = this.noOrderBySpaces.get(spaceName);
        if (at === undefined)
            return false;
        if (Date.now() - at >= GmailService_1.ORDER_BY_TTL_MS) {
            this.noOrderBySpaces.delete(spaceName);
            return false;
        }
        return true;
    }
    rememberOrderByRejected(spaceName) {
        this.noOrderBySpaces.set(spaceName, Date.now());
    }
    async getContacts(companyId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const record = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
            select: { gmailAddress: true },
        });
        const ownAddress = (record?.gmailAddress ?? '').toLowerCase();
        const CAP = 50;
        const [sentList, inboxList] = await Promise.all([
            gmail.users.messages.list({
                userId: 'me',
                maxResults: CAP,
                labelIds: ['SENT'],
            }),
            gmail.users.messages.list({
                userId: 'me',
                maxResults: CAP,
                labelIds: ['INBOX'],
            }),
        ]);
        const ids = [
            ...(sentList.data.messages ?? []),
            ...(inboxList.data.messages ?? []),
        ].map((m) => m.id);
        const details = await (0, pool_util_js_1.pool)(ids, pool_util_js_1.GMAIL_GET_CONCURRENCY, (id) => gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Cc'],
        }));
        const byEmail = new Map();
        for (const d of details) {
            const headers = d.data.payload?.headers ?? [];
            for (const field of ['From', 'To', 'Cc']) {
                const raw = headerValue(headers, field);
                for (const token of raw.split(',')) {
                    const parsed = parseAddress(token);
                    if (!parsed || parsed.email === ownAddress)
                        continue;
                    const existing = byEmail.get(parsed.email);
                    if (!existing)
                        byEmail.set(parsed.email, parsed);
                    else if (!existing.name && parsed.name)
                        existing.name = parsed.name;
                }
            }
        }
        return [...byEmail.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    }
    async markAsRead(companyId, messageId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: { removeLabelIds: ['UNREAD'] },
        });
        this.bustUnread(companyId);
    }
    async resolveChatSenders(auth, companyId, userResourceNames, scopeOk) {
        const resolved = new Map();
        const now = Date.now();
        const misses = [];
        for (const name of new Set(userResourceNames)) {
            const hit = this.senderCache.get(`${companyId}:${name}`);
            if (!hit) {
                misses.push(name);
                continue;
            }
            const known = hit.email ?? hit.displayName;
            const ttl = known ? GmailService_1.SENDER_TTL_MS : this.missTtl(companyId);
            const expired = now - hit.at > ttl;
            if (expired)
                misses.push(name);
            if (known)
                resolved.set(name, hit);
        }
        if (misses.length === 0)
            return resolved;
        const people = googleapis_1.google.people({ version: 'v1', auth });
        const directory = await this.getDomainDirectory(auth, companyId, scopeOk);
        const stillMissing = [];
        for (const name of misses) {
            const hit = directory.get(name);
            if (hit) {
                this.senderCache.set(`${companyId}:${name}`, {
                    ...hit,
                    at: Date.now(),
                });
                resolved.set(name, hit);
            }
            else {
                stillMissing.push(name);
            }
        }
        for (let i = 0; i < stillMissing.length; i += 50) {
            const chunk = stillMissing.slice(i, i + 50);
            try {
                const res = await people.people.getBatchGet({
                    resourceNames: chunk.map((n) => `people/${n.replace('users/', '')}`),
                    personFields: 'names,emailAddresses',
                });
                for (const r of res.data.responses ?? []) {
                    const requested = r.requestedResourceName ?? '';
                    const userName = `users/${requested.replace('people/', '')}`;
                    const person = r.person;
                    const entry = {
                        email: person?.emailAddresses?.[0]?.value ?? undefined,
                        displayName: person?.names?.[0]?.displayName ?? undefined,
                    };
                    this.senderCache.set(`${companyId}:${userName}`, {
                        ...entry,
                        at: Date.now(),
                    });
                    if (entry.email || entry.displayName)
                        resolved.set(userName, entry);
                }
                this.notePeopleSuccess(companyId);
            }
            catch (err) {
                this.notePeopleFailure(companyId, 'people.getBatchGet', err, scopeOk);
                for (const name of chunk) {
                    const key = `${companyId}:${name}`;
                    const hit = this.senderCache.get(key);
                    if (hit?.email || hit?.displayName)
                        continue;
                    this.senderCache.set(key, { at: Date.now() });
                }
                break;
            }
        }
        for (const name of stillMissing) {
            if (resolved.has(name))
                continue;
            const key = `${companyId}:${name}`;
            const hit = this.senderCache.get(key);
            if (hit?.email || hit?.displayName)
                continue;
            this.senderCache.set(key, { at: Date.now() });
        }
        return resolved;
    }
    notePeopleFailure(companyId, where, err, scopeOk) {
        const e = err;
        const apiError = e?.response?.data?.error;
        const status = apiError?.status ?? e?.status ?? e?.code;
        const message = apiError?.message ?? e?.message ?? String(err);
        const apiDisabled = status === 'SERVICE_DISABLED' ||
            /SERVICE_DISABLED|has not been used|is disabled/i.test(message);
        const kind = apiDisabled
            ? 'api_disabled'
            : !scopeOk
                ? 'scopes'
                : null;
        if (kind)
            this.senderFailure.set(companyId, { kind, at: Date.now() });
        else
            this.senderFailure.delete(companyId);
        if (!this.senderLookupWarned.has(companyId)) {
            this.senderLookupWarned.add(companyId);
            console.warn(`[gmail] Chat sender lookup failed for company ${companyId} in ${where} — ` +
                `senders may show as "Unknown". diagnosis=${kind ?? 'undisclosed'} ` +
                `status=${String(status)} message=${message}`);
        }
    }
    notePeopleSuccess(companyId) {
        this.senderFailure.delete(companyId);
        this.senderLookupWarned.delete(companyId);
    }
    missTtl(companyId) {
        return this.senderFailure.has(companyId)
            ? GmailService_1.PEOPLE_RETRY_MS
            : GmailService_1.SENDER_MISS_TTL_MS;
    }
    clearSenderState(companyId) {
        this.senderFailure.delete(companyId);
        this.senderLookupWarned.delete(companyId);
        this.memberListWarned.delete(companyId);
        this.directoryCache.delete(companyId);
        const prefix = `${companyId}:`;
        for (const key of this.senderCache.keys()) {
            if (key.startsWith(prefix))
                this.senderCache.delete(key);
        }
        this.spacesCache.delete(companyId);
        for (const key of this.membersCache.keys()) {
            if (key.startsWith(prefix))
                this.membersCache.delete(key);
        }
        for (const key of this.messageCache.keys()) {
            if (key.startsWith(prefix))
                this.messageCache.delete(key);
        }
        this.unreadCache.delete(companyId);
    }
    diagnoseSenderNames(companyId, unknownCount) {
        if (unknownCount === 0)
            return null;
        return this.senderFailure.get(companyId)?.kind ?? 'undisclosed';
    }
    async getDomainDirectory(auth, companyId, scopeOk) {
        const now = Date.now();
        const cached = this.directoryCache.get(companyId);
        if (cached) {
            const ttl = cached.map.size
                ? GmailService_1.SENDER_TTL_MS
                : this.missTtl(companyId);
            if (now - cached.at < ttl)
                return cached.map;
        }
        const map = new Map();
        const people = googleapis_1.google.people({ version: 'v1', auth });
        try {
            let pageToken;
            do {
                const res = await people.people.listDirectoryPeople({
                    readMask: 'names,emailAddresses',
                    sources: ['DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE'],
                    pageSize: 1000,
                    pageToken,
                });
                for (const p of res.data.people ?? []) {
                    if (!p.resourceName)
                        continue;
                    const userName = `users/${p.resourceName.replace('people/', '')}`;
                    const entry = {
                        email: p.emailAddresses?.[0]?.value ?? undefined,
                        displayName: p.names?.[0]?.displayName ?? undefined,
                    };
                    if (entry.email || entry.displayName)
                        map.set(userName, entry);
                }
                pageToken = res.data.nextPageToken ?? undefined;
            } while (pageToken);
            this.notePeopleSuccess(companyId);
        }
        catch (err) {
            this.notePeopleFailure(companyId, 'listDirectoryPeople', err, scopeOk);
        }
        this.directoryCache.set(companyId, { map, at: now });
        return map;
    }
    async getChats(companyId, cursor, q) {
        const query = q?.trim().toLowerCase();
        let auth;
        try {
            auth = await this.ensureFreshTokens(companyId);
        }
        catch {
            return {
                messages: [],
                needsReconnect: true,
                chatStatus: 'needs_reconnect',
                senderNamesUnavailable: null,
                nextCursor: null,
                hasMore: false,
            };
        }
        try {
            const chat = googleapis_1.google.chat({ version: 'v1', auth });
            const spaces = await this.listSpacesCached(companyId, chat);
            if (spaces.length === 0) {
                return {
                    messages: [],
                    needsReconnect: false,
                    chatStatus: 'no_spaces',
                    senderNamesUnavailable: null,
                    nextCursor: null,
                    hasMore: false,
                };
            }
            let cursorMap = null;
            if (cursor) {
                try {
                    cursorMap = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
                }
                catch {
                    cursorMap = null;
                }
            }
            const targetSpaces = cursorMap
                ? spaces.filter((s) => s.name && cursorMap[s.name])
                : spaces;
            const messages = [];
            const pending = [];
            const acctRows = await this.prisma.$queryRaw `
        SELECT chatUserId, scope FROM GmailAccount WHERE companyId = ${companyId} LIMIT 1
      `;
            const selfName = acctRows[0]?.chatUserId
                ? `users/${acctRows[0].chatUserId}`
                : null;
            const scopeOk = grantsPeopleScopes(acctRows[0]?.scope);
            const [readSet, completedSet] = await Promise.all([
                this.state.getReadSet(companyId),
                this.state.getCompletedSet(companyId),
            ]);
            const memberDisplayNames = new Map();
            await Promise.allSettled(targetSpaces.map(async (space) => {
                try {
                    const names = await this.spaceMembersCached(companyId, chat, space.name);
                    for (const [name, display] of names)
                        memberDisplayNames.set(name, display);
                }
                catch (err) {
                    if (!this.memberListWarned.has(companyId)) {
                        this.memberListWarned.add(companyId);
                        console.warn(`[gmail] spaces.members.list failed for company ${companyId} — ` +
                            `chat sender displayNames unavailable:`, err instanceof Error ? err.message : err);
                    }
                }
            }));
            let failedSpaces = 0;
            let firstSpaceError;
            const nextTokens = {};
            for (const space of targetSpaces) {
                const spaceType = space.spaceType ?? 'SPACE';
                const spaceName = space.displayName ||
                    (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
                try {
                    const pageToken = cursorMap ? cursorMap[space.name] : undefined;
                    const listArgs = {
                        parent: space.name,
                        pageSize: query ? 50 : 25,
                        ...(pageToken ? { pageToken } : {}),
                    };
                    const msgsRes = await chat.spaces.messages
                        .list(this.spaceRejectsOrderBy(space.name)
                        ? listArgs
                        : { ...listArgs, orderBy: 'createTime DESC' })
                        .catch(() => {
                        this.rememberOrderByRejected(space.name);
                        return chat.spaces.messages.list(listArgs);
                    });
                    if (msgsRes.data.nextPageToken && space.name) {
                        nextTokens[space.name] = msgsRes.data.nextPageToken;
                    }
                    for (const msg of msgsRes.data.messages ?? []) {
                        if (selfName && msg.sender?.name === selfName)
                            continue;
                        pending.push({
                            msg,
                            spaceId: space.name ?? '',
                            spaceName,
                            spaceType,
                        });
                    }
                }
                catch (err) {
                    const spaceErr = err;
                    const spaceStatus = (spaceErr.response?.status ?? Number(spaceErr.code ?? 0)) ||
                        undefined;
                    console.error(`[Gmail] Failed to load messages for space ${space.name ?? '?'} type=${spaceType} (HTTP ${spaceStatus ?? '?'}):`, spaceErr.message ?? err);
                    if (!firstSpaceError)
                        firstSpaceError = {
                            status: spaceStatus,
                            message: spaceErr.message,
                        };
                    failedSpaces++;
                }
            }
            if (failedSpaces > 0 && failedSpaces === targetSpaces.length) {
                if (firstSpaceError?.status === 403 ||
                    firstSpaceError?.status === 401) {
                    return {
                        messages: [],
                        needsReconnect: true,
                        chatStatus: 'needs_reconnect',
                        senderNamesUnavailable: null,
                        nextCursor: null,
                        hasMore: false,
                    };
                }
                if (firstSpaceError?.status === 404) {
                    return {
                        messages: [],
                        needsReconnect: false,
                        chatStatus: 'app_not_configured',
                        senderNamesUnavailable: null,
                        nextCursor: null,
                        hasMore: false,
                    };
                }
                return {
                    messages: [],
                    needsReconnect: false,
                    chatStatus: 'error',
                    senderNamesUnavailable: null,
                    nextCursor: null,
                    hasMore: false,
                };
            }
            const senders = await this.resolveChatSenders(auth, companyId, pending
                .map((p) => p.msg.sender?.name)
                .filter((n) => Boolean(n)), scopeOk);
            let unknownSenders = 0;
            for (const { msg, spaceId, spaceName, spaceType } of pending) {
                const senderName = chatSenderLabel(msg.sender, senders, memberDisplayNames);
                const id = msg.name ?? '';
                const text = msg.text ?? '';
                if (query &&
                    ![text, senderName, spaceName].some((s) => s.toLowerCase().includes(query))) {
                    continue;
                }
                if (senderName === 'Unknown')
                    unknownSenders++;
                messages.push({
                    id,
                    spaceId,
                    spaceName,
                    spaceType,
                    sender: senderName,
                    text,
                    createTime: msg.createTime ?? '',
                    lastUpdateTime: msg.lastUpdateTime ?? msg.createTime ?? '',
                    quotedMessageName: msg.quotedMessageMetadata?.name ?? null,
                    isRead: readSet.has(id),
                    isCompleted: completedSet.has(id),
                    hasAttachments: (msg.attachment?.length ?? 0) > 0,
                });
            }
            messages.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
            const hasMore = Object.keys(nextTokens).length > 0;
            const nextCursor = hasMore
                ? Buffer.from(JSON.stringify(nextTokens)).toString('base64')
                : null;
            return {
                messages,
                needsReconnect: false,
                chatStatus: 'ok',
                senderNamesUnavailable: this.diagnoseSenderNames(companyId, unknownSenders),
                nextCursor,
                hasMore,
            };
        }
        catch (err) {
            console.error('[Gmail] getChats error:', err);
            const errAny = err;
            const httpStatus = (errAny.response?.status ??
                Number(errAny.code ?? errAny.status ?? 0)) ||
                undefined;
            if (httpStatus === 403 || httpStatus === 401) {
                return {
                    messages: [],
                    needsReconnect: true,
                    chatStatus: 'needs_reconnect',
                    senderNamesUnavailable: null,
                    nextCursor: null,
                    hasMore: false,
                };
            }
            if (httpStatus === 404) {
                return {
                    messages: [],
                    needsReconnect: false,
                    chatStatus: 'app_not_configured',
                    senderNamesUnavailable: null,
                    nextCursor: null,
                    hasMore: false,
                };
            }
            const isChatDisabled = errAny.cause?.status === 'FAILED_PRECONDITION' ||
                String(errAny.message ?? '')
                    .toLowerCase()
                    .includes('chat is turned off') ||
                String(errAny.message ?? '')
                    .toLowerCase()
                    .includes('failed_precondition');
            if (httpStatus === 400 && isChatDisabled) {
                return {
                    messages: [],
                    needsReconnect: false,
                    chatStatus: 'chat_disabled',
                    senderNamesUnavailable: null,
                    nextCursor: null,
                    hasMore: false,
                };
            }
            return {
                messages: [],
                needsReconnect: false,
                chatStatus: 'error',
                senderNamesUnavailable: null,
                nextCursor: null,
                hasMore: false,
            };
        }
    }
    async getChatThread(companyId, spaceId, pageToken) {
        let auth;
        try {
            auth = await this.ensureFreshTokens(companyId);
        }
        catch {
            return { messages: [], nextPageToken: null, needsReconnect: true };
        }
        const chat = googleapis_1.google.chat({ version: 'v1', auth });
        const memberDisplayNames = new Map();
        try {
            const membersRes = await chat.spaces.members.list({
                parent: spaceId,
                pageSize: 100,
            });
            for (const m of membersRes.data.memberships ?? []) {
                if (m.member?.name && m.member.displayName) {
                    memberDisplayNames.set(m.member.name, m.member.displayName);
                }
            }
        }
        catch {
        }
        let spaceType = 'SPACE';
        let spaceName = 'Direct Message';
        try {
            const sp = await chat.spaces.get({ name: spaceId });
            spaceType = sp.data.spaceType ?? 'SPACE';
            spaceName =
                sp.data.displayName ||
                    (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
        }
        catch {
        }
        const listArgs = { parent: spaceId, pageSize: 100, pageToken };
        const msgsRes = await chat.spaces.messages
            .list({ ...listArgs, orderBy: 'createTime DESC' })
            .catch(() => chat.spaces.messages.list(listArgs));
        const acctRows = await this.prisma.$queryRaw `
      SELECT chatUserId, scope FROM GmailAccount WHERE companyId = ${companyId} LIMIT 1
    `;
        const selfName = acctRows[0]?.chatUserId
            ? `users/${acctRows[0].chatUserId}`
            : null;
        const senders = await this.resolveChatSenders(auth, companyId, (msgsRes.data.messages ?? [])
            .map((m) => m.sender?.name)
            .filter((n) => Boolean(n)), grantsPeopleScopes(acctRows[0]?.scope));
        const messages = (msgsRes.data.messages ?? []).map((msg) => ({
            id: msg.name ?? '',
            spaceId,
            spaceName,
            spaceType,
            sender: chatSenderLabel(msg.sender, senders, memberDisplayNames),
            text: msg.text ?? '',
            createTime: msg.createTime ?? '',
            lastUpdateTime: msg.lastUpdateTime ?? msg.createTime ?? '',
            quotedMessageName: msg.quotedMessageMetadata?.name ?? null,
            isOwn: selfName ? msg.sender?.name === selfName : false,
            attachments: mapChatAttachments(msg.attachment),
        }));
        messages.sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime());
        return {
            messages,
            nextPageToken: msgsRes.data.nextPageToken ?? null,
            spaceName,
            spaceType,
        };
    }
    async markChatRead(companyId, messageId) {
        await this.state.markChatRead(companyId, messageId);
    }
    async markChatUnread(companyId, messageId) {
        await this.state.markChatUnread(companyId, messageId);
    }
    async markComplete(companyId, messageId) {
        await this.state.markComplete(companyId, messageId);
    }
    async markUncomplete(companyId, messageId) {
        await this.state.markUncomplete(companyId, messageId);
    }
    async withRetry(fn, label) {
        const ATTEMPTS = 4;
        const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
        const RETRYABLE_REASON = new Set([
            'rateLimitExceeded',
            'userRateLimitExceeded',
            'backendError',
        ]);
        for (let attempt = 0;; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                const e = err;
                const status = typeof e.code === 'number'
                    ? e.code
                    : (e.response?.status ?? Number(e.code));
                const reason = e.errors?.[0]?.reason;
                const retryable = RETRYABLE_STATUS.has(status) ||
                    (reason ? RETRYABLE_REASON.has(reason) : false);
                if (!retryable || attempt >= ATTEMPTS - 1)
                    throw err;
                const delay = 500 * 2 ** attempt + Math.floor(Math.random() * 250);
                console.warn(`[Gmail] ${label} failed (${status ?? reason}) — retrying in ${delay}ms (attempt ${attempt + 1}/${ATTEMPTS})`);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }
    }
    async flushCompleted(companyId, ids) {
        return this.state.flushCompleted(companyId, ids);
    }
    async markExistingAsCompletedOnConnect(companyId, auth) {
        const MAX_EMAIL_IDS = 50000;
        const MAX_CHAT_IDS = 5000;
        const MAX_MSGS_PER_SPACE = 1000;
        let emailWritten = 0;
        let chatWritten = 0;
        try {
            const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
            let emailPageToken;
            do {
                const res = await this.withRetry(() => gmail.users.messages.list({
                    userId: 'me',
                    labelIds: ['INBOX'],
                    q: '-is:unread',
                    maxResults: 500,
                    pageToken: emailPageToken,
                    fields: 'messages/id,nextPageToken',
                }), `messages.list (company ${companyId})`);
                const pageIds = (res.data.messages ?? [])
                    .map((m) => m.id)
                    .filter((id) => !!id);
                emailWritten += await this.flushCompleted(companyId, pageIds);
                emailPageToken = res.data.nextPageToken ?? undefined;
            } while (emailPageToken && emailWritten < MAX_EMAIL_IDS);
        }
        catch (err) {
            console.warn(`[Gmail] Connect sweep for company ${companyId}: email stage failed after ${emailWritten} ids —`, err);
        }
        try {
            const chat = googleapis_1.google.chat({ version: 'v1', auth });
            let spacePageToken;
            do {
                const spacesRes = await this.withRetry(() => chat.spaces.list({ pageSize: 100, pageToken: spacePageToken }), `spaces.list (company ${companyId})`);
                for (const space of spacesRes.data.spaces ?? []) {
                    if (!space.name)
                        continue;
                    if (chatWritten >= MAX_CHAT_IDS)
                        break;
                    let spaceCount = 0;
                    try {
                        let msgPageToken;
                        do {
                            const msgsRes = await this.withRetry(() => chat.spaces.messages.list({
                                parent: space.name,
                                pageSize: 100,
                                pageToken: msgPageToken,
                            }), `spaces.messages.list ${space.name} (company ${companyId})`);
                            const pageIds = (msgsRes.data.messages ?? [])
                                .map((m) => m.name)
                                .filter((name) => !!name);
                            const written = await this.flushCompleted(companyId, pageIds);
                            chatWritten += written;
                            spaceCount += written;
                            msgPageToken = msgsRes.data.nextPageToken ?? undefined;
                        } while (msgPageToken &&
                            chatWritten < MAX_CHAT_IDS &&
                            spaceCount < MAX_MSGS_PER_SPACE);
                    }
                    catch {
                    }
                }
                spacePageToken = spacesRes.data.nextPageToken ?? undefined;
            } while (spacePageToken && chatWritten < MAX_CHAT_IDS);
        }
        catch (err) {
            console.warn(`[Gmail] Connect sweep for company ${companyId}: chat stage failed after ${chatWritten} ids —`, err);
        }
        this.state.bustUncompleted(companyId);
        console.log(`[Gmail] Connect sweep for company ${companyId}: marked ${emailWritten} emails + ${chatWritten} chat messages as completed.`);
    }
    async getUnreadCount(companyId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
        const emailUnread = res.data.messagesUnread ?? 0;
        let chatUnread = 0;
        try {
            const chats = await this.getChats(companyId);
            const msgs = (chats.messages ?? []);
            chatUnread = msgs.filter((m) => !m.isRead).length;
        }
        catch {
        }
        return { count: emailUnread + chatUnread };
    }
    async getUncompletedCount(companyId) {
        return this.state.getUncompletedCount(companyId, () => this.computeUncompletedCount(companyId).then((r) => r.count));
    }
    async getUncompletedCounts() {
        const accounts = await this.prisma.gmailAccount.findMany({
            select: { companyId: true },
        });
        const ids = accounts.map((a) => a.companyId);
        const counts = {};
        const CONCURRENCY = 4;
        let cursor = 0;
        const worker = async () => {
            while (cursor < ids.length) {
                const companyId = ids[cursor++];
                try {
                    const { count } = await this.getUncompletedCount(companyId);
                    counts[companyId] = count;
                }
                catch (err) {
                    console.error(`[gmail] uncompleted count failed for company ${companyId}:`, err instanceof Error ? err.message : err);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
        return counts;
    }
    async getLatestPreview(companyId) {
        const [email, chat] = await Promise.all([
            this.latestEmailPreview(companyId).catch((err) => {
                this.logPreviewFailure('email', companyId, err);
                return null;
            }),
            this.latestChatPreview(companyId).catch((err) => {
                this.logPreviewFailure('chat', companyId, err);
                return null;
            }),
        ]);
        if (!email)
            return chat;
        if (!chat)
            return email;
        return Date.parse(chat.receivedAt) > Date.parse(email.receivedAt)
            ? chat
            : email;
    }
    logPreviewFailure(kind, companyId, err) {
        console.error(`[gmail] latest ${kind} preview failed for company ${companyId}:`, err instanceof Error ? err.message : err);
    }
    async latestEmailPreview(companyId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const list = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 1,
            labelIds: ['INBOX'],
        });
        const id = list.data.messages?.[0]?.id;
        if (!id)
            return null;
        const detail = await gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
        });
        const headers = detail.data.payload?.headers ?? [];
        const received = detail.data.internalDate
            ? new Date(Number(detail.data.internalDate))
            : new Date(headerValue(headers, 'Date') || Date.now());
        return {
            from: (0, preview_util_js_1.fromDisplayName)(headerValue(headers, 'From')),
            subject: headerValue(headers, 'Subject'),
            snippet: (0, preview_util_js_1.decodeHtmlEntities)(detail.data.snippet ?? ''),
            receivedAt: received.toISOString(),
            kind: 'email',
        };
    }
    async latestChatPreview(companyId) {
        const chats = await this.getChats(companyId);
        const newest = chats.messages[0];
        if (!newest)
            return null;
        return {
            from: newest.sender,
            subject: '',
            snippet: newest.text,
            receivedAt: newest.createTime,
            kind: 'chat',
        };
    }
    async getUncompletedEmailIds(companyId, q) {
        return this.state.getCachedEmailIds(companyId, q, async () => {
            const auth = await this.ensureFreshTokens(companyId);
            const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
            const MAX_PAGES = 40;
            const inboxIds = [];
            let pageToken;
            for (let page = 0; page < MAX_PAGES; page++) {
                const res = await gmail.users.messages.list({
                    userId: 'me',
                    maxResults: 500,
                    labelIds: ['INBOX'],
                    ...(q ? { q } : {}),
                    ...(pageToken ? { pageToken } : {}),
                    fields: 'messages/id,nextPageToken',
                });
                for (const m of res.data.messages ?? [])
                    if (m.id)
                        inboxIds.push(m.id);
                pageToken = res.data.nextPageToken ?? undefined;
                if (!pageToken)
                    break;
                if (page === MAX_PAGES - 1) {
                    console.warn(`[gmail] getUncompletedEmailIds hit page cap for company ${companyId} — count/list may be truncated`);
                }
            }
            const completedSet = await this.state.getCompletedSet(companyId);
            return inboxIds.filter((id) => !completedSet.has(id));
        });
    }
    async computeUncompletedCount(companyId) {
        const emailUncompleted = (await this.getUncompletedEmailIds(companyId))
            .length;
        let chatUncompleted = 0;
        try {
            const chats = await this.getChats(companyId);
            const msgs = (chats.messages ?? []);
            chatUncompleted = msgs.filter((m) => !m.isCompleted).length;
        }
        catch {
        }
        return { count: emailUncompleted + chatUncompleted };
    }
    parseNonInlineAttachments(payload) {
        const p = payload;
        const bodyHtml = extractPart(p, 'text/html');
        const referencedCids = (0, inline_attachments_util_js_1.referencedCidsFromHtml)(bodyHtml);
        return extractAttachments(p, referencedCids).filter((a) => !a.isInline);
    }
    async getEmail(companyId, messageId, immutable = false) {
        void immutable;
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });
        return this.mapGmailMessageToDetail(companyId, res.data);
    }
    async getEmailThread(companyId, threadId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'full',
        });
        const rawMessages = res.data.messages ?? [];
        const messages = await Promise.all(rawMessages.map((m) => this.mapGmailMessageToDetail(companyId, m)));
        return { messages };
    }
    async mapGmailMessageToDetail(companyId, message) {
        const messageId = message.id ?? '';
        const headers = message.payload?.headers ?? [];
        const h = (name) => headerValue(headers, name);
        const payload = message.payload;
        const bodyHtml = extractPart(payload, 'text/html');
        const bodyText = extractPart(payload, 'text/plain');
        const referencedCids = (0, inline_attachments_util_js_1.referencedCidsFromHtml)(bodyHtml);
        const attachments = extractAttachments(payload, referencedCids);
        const forwardRows = await this.state.getForwards(companyId, messageId);
        return {
            id: messageId,
            threadId: message.threadId ?? '',
            messageId: h('Message-ID'),
            references: h('References'),
            subject: h('Subject'),
            from: h('From'),
            to: h('To'),
            cc: h('Cc'),
            date: h('Date'),
            snippet: message.snippet ?? '',
            bodyHtml,
            bodyText,
            attachments,
            isForwarded: forwardRows.length > 0,
            forwards: forwardRows.map((r) => ({
                to: r.recipient ?? '',
                at: r.forwardedAt.toISOString(),
                messageId: r.sentMessageId ?? null,
            })),
        };
    }
    async getEmailAttachment(companyId, messageId, attachmentId, file) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const fetchBytes = async (id) => {
            const res = await gmail.users.messages.attachments.get({
                userId: 'me',
                messageId,
                id,
            });
            return Buffer.from(res.data.data ?? '', 'base64url');
        };
        try {
            return await fetchBytes(attachmentId);
        }
        catch (err) {
            const status = err?.code;
            console.warn(`[Gmail] attachment fetch failed for company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
            if (status !== 404 && status !== 410) {
                throw new common_1.BadGatewayException('Could not fetch the attachment from Gmail.');
            }
            const currentId = file
                ? await this.resolveAttachmentId(gmail, messageId, file)
                : null;
            if (currentId && currentId !== attachmentId) {
                try {
                    return await fetchBytes(currentId);
                }
                catch (retryErr) {
                    console.warn(`[Gmail] attachment retry with re-resolved id failed for company ${companyId}: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
                }
            }
            throw new common_1.NotFoundException('This attachment is no longer available — refresh the message and try again.');
        }
    }
    async resolveAttachmentId(gmail, messageId, file) {
        try {
            const res = await gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full',
            });
            const parts = extractAttachments(res.data.payload, new Set());
            const exact = parts.find((a) => a.filename === file.filename && a.size === file.size);
            const byName = parts.find((a) => a.filename === file.filename);
            return (exact ?? byName)?.attachmentId ?? null;
        }
        catch (err) {
            console.warn(`[Gmail] could not re-resolve attachment id for ${messageId}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    async getChatAttachment(companyId, resourceName) {
        const auth = await this.ensureFreshTokens(companyId);
        const chat = googleapis_1.google.chat({ version: 'v1', auth });
        const res = await chat.media.download({ resourceName, alt: 'media' }, { responseType: 'arraybuffer' });
        return Buffer.from(res.data);
    }
    async transcodeAudioToMp3(input) {
        if (!ffmpeg_static_1.default)
            throw new Error('ffmpeg binary not available');
        const bin = ffmpeg_static_1.default;
        return new Promise((resolve, reject) => {
            const proc = (0, child_process_1.spawn)(bin, [
                '-i',
                'pipe:0',
                '-vn',
                '-c:a',
                'libmp3lame',
                '-q:a',
                '4',
                '-f',
                'mp3',
                'pipe:1',
            ]);
            const chunks = [];
            let stderr = '';
            proc.stdout.on('data', (d) => chunks.push(d));
            proc.stderr.on('data', (d) => {
                stderr += d.toString();
            });
            proc.on('error', reject);
            proc.on('close', (code) => {
                if (code === 0 && chunks.length)
                    resolve(Buffer.concat(chunks));
                else
                    reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
            });
            proc.stdin.on('error', () => {
            });
            proc.stdin.write(input);
            proc.stdin.end();
        });
    }
    async sendEmail(companyId, dto, attachments = []) {
        try {
            await this.sendEmailWithStagedFiles(companyId, dto, attachments);
        }
        catch (err) {
            throw (0, send_error_util_js_1.translateSendError)(err, 'gmail', companyId, this.logger);
        }
        finally {
            await (0, outbound_uploads_js_1.discardOutboundFiles)(attachments);
        }
    }
    async prepareOutbound(companyId, dto, attachments) {
        let auth = await this.ensureFreshTokens(companyId, SEND_TOKEN_MIN_MS);
        let gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const { inline, linked } = (0, outbound_uploads_js_1.splitBySizeBudget)(attachments);
        const account = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
            select: { scope: true, gmailAddress: true },
        });
        let body = dto.body ?? '';
        let bodyHtml = dto.bodyHtml;
        if (linked.length > 0) {
            if (!(0, drive_upload_js_1.grantsDriveUpload)(account?.scope)) {
                throw new common_1.BadRequestException('Large attachments are shared through Google Drive, which this mailbox ' +
                    "hasn't authorised yet. Disconnect and reconnect it in the " +
                    'Communications tab, then try again.');
            }
            const links = await (0, drive_upload_js_1.uploadAllToDrive)((0, drive_upload_js_1.makeDriveClient)(auth), linked);
            ({ body, bodyHtml } = (0, link_attachments_util_js_1.appendLinkBlock)(body, bodyHtml, links, 'drive'));
            auth = await this.ensureFreshTokens(companyId, SEND_TOKEN_MIN_MS);
            gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        }
        const senderDomain = account?.gmailAddress?.split('@')[1]?.trim() || 'cygfinance.com';
        const ownMessageId = `<${crypto.randomUUID()}@${senderDomain}>`;
        const references = [dto.references, dto.inReplyTo]
            .filter((v) => !!v && v.trim().length > 0)
            .join(' ')
            .trim();
        const headers = [
            ...(dto.to ? [`To: ${dto.to}`] : []),
            ...(dto.cc ? [`Cc: ${dto.cc}`] : []),
            ...(dto.bcc ? [`Bcc: ${dto.bcc}`] : []),
            `Subject: ${(0, encode_header_js_1.encodeHeaderWord)(dto.subject ?? '')}`,
            `Message-ID: ${ownMessageId}`,
            ...(dto.inReplyTo ? [`In-Reply-To: ${dto.inReplyTo}`] : []),
            ...(references ? [`References: ${references}`] : []),
            'MIME-Version: 1.0',
        ];
        const b64wrap = (input) => (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8'))
            .toString('base64')
            .replace(/(.{76})/g, '$1\r\n');
        const hasHtml = !!bodyHtml && bodyHtml.trim() !== '';
        let contentHeader;
        let contentBody;
        if (hasHtml) {
            const altBoundary = `alt_${Date.now().toString(36)}_${Math.random()
                .toString(36)
                .slice(2)}`;
            contentHeader = [
                `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
            ];
            contentBody = [
                `--${altBoundary}`,
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: base64',
                '',
                b64wrap(body),
                `--${altBoundary}`,
                'Content-Type: text/html; charset=utf-8',
                'Content-Transfer-Encoding: base64',
                '',
                b64wrap(bodyHtml),
                `--${altBoundary}--`,
            ];
        }
        else {
            contentHeader = [
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: base64',
            ];
            contentBody = [b64wrap(body)];
        }
        let message;
        if (inline.length === 0) {
            message = [...headers, ...contentHeader, '', ...contentBody].join('\r\n');
        }
        else {
            const mixBoundary = `mix_${Date.now().toString(36)}_${Math.random()
                .toString(36)
                .slice(2)}`;
            const parts = [
                `--${mixBoundary}`,
                ...contentHeader,
                '',
                ...contentBody,
            ];
            for (const f of inline) {
                const { asciiName, filenameParam } = (0, attachment_name_util_js_1.attachmentNameParams)(f.originalname);
                const bytes = await (0, promises_1.readFile)(f.path);
                parts.push(`--${mixBoundary}`, `Content-Type: ${f.mimetype || 'application/octet-stream'}; name="${asciiName}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${asciiName}"${filenameParam}`, '', b64wrap(bytes));
            }
            parts.push(`--${mixBoundary}--`, '');
            message = [
                ...headers,
                `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
                '',
                ...parts,
            ].join('\r\n');
        }
        const threadPart = dto.threadId ? { threadId: dto.threadId } : {};
        return { gmail, message, ownMessageId, threadPart };
    }
    async sendEmailWithStagedFiles(companyId, dto, attachments) {
        const { gmail, message, ownMessageId, threadPart } = await this.prepareOutbound(companyId, dto, attachments);
        const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
        const issueSend = (client) => Buffer.byteLength(message) > SIMPLE_UPLOAD_MAX
            ? client.users.messages.send({
                userId: 'me',
                requestBody: threadPart,
                media: { mimeType: 'message/rfc822', body: message },
            })
            : client.users.messages.send({
                userId: 'me',
                requestBody: {
                    raw: Buffer.from(message).toString('base64url'),
                    ...threadPart,
                },
            });
        const sentId = await this.sendWithRetry(companyId, gmail, issueSend, ownMessageId);
        if (dto.forwardedFrom) {
            await this.state.recordForward(companyId, dto.forwardedFrom, dto.to, sentId);
        }
    }
    issueDraftWrite(gmail, message, threadPart, draftId) {
        const SIMPLE_UPLOAD_MAX = 4 * 1024 * 1024;
        const big = Buffer.byteLength(message) > SIMPLE_UPLOAD_MAX;
        const params = {
            userId: 'me',
            ...(draftId ? { id: draftId } : {}),
            requestBody: {
                ...(draftId ? { id: draftId } : {}),
                message: big
                    ? threadPart
                    : { raw: Buffer.from(message).toString('base64url'), ...threadPart },
            },
            ...(big ? { media: { mimeType: 'message/rfc822', body: message } } : {}),
        };
        return draftId
            ? gmail.users.drafts.update(params)
            : gmail.users.drafts.create(params);
    }
    async createDraft(companyId, dto, attachments = []) {
        try {
            const { gmail, message, threadPart } = await this.prepareOutbound(companyId, dto, attachments);
            const res = await this.issueDraftWrite(gmail, message, threadPart);
            return {
                draftId: res.data.id ?? '',
                messageId: res.data.message?.id ?? null,
                threadId: res.data.message?.threadId ?? null,
            };
        }
        catch (err) {
            throw (0, send_error_util_js_1.translateDraftError)(err, 'gmail', companyId, this.logger);
        }
        finally {
            await (0, outbound_uploads_js_1.discardOutboundFiles)(attachments);
        }
    }
    async updateDraft(companyId, draftId, dto, attachments) {
        try {
            const carried = attachments ??
                (await this.carryOverAttachments(companyId, draftId, [], dto.hasAttachments));
            const { gmail, message, threadPart } = await this.prepareOutbound(companyId, dto, carried);
            const res = await this.issueDraftWrite(gmail, message, threadPart, draftId);
            return {
                draftId: res.data.id ?? draftId,
                messageId: res.data.message?.id ?? null,
                threadId: res.data.message?.threadId ?? null,
            };
        }
        catch (err) {
            throw (0, send_error_util_js_1.translateDraftError)(err, 'gmail', companyId, this.logger);
        }
        finally {
            await (0, outbound_uploads_js_1.discardOutboundFiles)(attachments ?? []);
        }
    }
    async getDraft(companyId, draftId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.drafts.get({
            userId: 'me',
            id: draftId,
            format: 'full',
        });
        const msg = res.data.message ?? {};
        const detail = await this.mapGmailMessageToDetail(companyId, msg);
        const headers = msg.payload?.headers ?? [];
        return {
            draftId: res.data.id ?? draftId,
            messageId: msg.id ?? null,
            threadId: msg.threadId ?? null,
            to: detail.to,
            cc: detail.cc,
            bcc: headerValue(headers, 'Bcc'),
            subject: detail.subject,
            bodyHtml: detail.bodyHtml ?? '',
            bodyText: detail.bodyText ?? '',
            inReplyTo: headerValue(headers, 'In-Reply-To'),
            references: detail.references,
            attachments: detail.attachments,
        };
    }
    async deleteDraft(companyId, draftId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        await gmail.users.drafts.delete({ userId: 'me', id: draftId });
    }
    async sendDraft(companyId, draftId) {
        try {
            const auth = await this.ensureFreshTokens(companyId, SEND_TOKEN_MIN_MS);
            const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
            const res = await gmail.users.drafts.send({
                userId: 'me',
                requestBody: { id: draftId },
            });
            return res.data.id ?? null;
        }
        catch (err) {
            throw (0, send_error_util_js_1.translateSendError)(err, 'gmail', companyId, this.logger);
        }
    }
    async carryOverAttachments(companyId, draftId, supplied, known) {
        if (supplied.length > 0)
            return supplied;
        if (known === 'false')
            return supplied;
        let existing;
        try {
            existing = await this.getDraft(companyId, draftId);
        }
        catch {
            return supplied;
        }
        if (existing.attachments.length === 0 || !existing.messageId) {
            return supplied;
        }
        const staged = await this.stageDraftAttachments(companyId, existing);
        return staged.map((s) => s.file);
    }
    async stageDraftAttachments(companyId, draft) {
        if (!draft.messageId)
            return [];
        const out = [];
        for (const att of draft.attachments) {
            if (!att.attachmentId)
                continue;
            const bytes = await this.getEmailAttachment(companyId, draft.messageId, att.attachmentId, { filename: att.filename, size: att.size });
            out.push({
                attachmentId: att.attachmentId,
                file: await (0, outbound_uploads_js_1.stageOutboundBuffer)(bytes, att.filename, att.mimeType),
            });
        }
        return out;
    }
    async sendWithRetry(companyId, gmail, issueSend, ownMessageId) {
        try {
            const res = await issueSend(gmail);
            return res.data.id ?? null;
        }
        catch (err) {
            const auth = (0, send_error_util_js_1.isAuthSendError)(err);
            if (!auth && !(0, send_error_util_js_1.isRetryableSendError)(err))
                throw err;
            if (auth) {
                this.logger.warn(`sendEmail 401 for company ${companyId}; refreshing and retrying once`);
                const fresh = await this.forceFreshTokens(companyId);
                const res = await issueSend(googleapis_1.google.gmail({ version: 'v1', auth: fresh }));
                return res.data.id ?? null;
            }
            const already = await this.findSentByMessageId(gmail, ownMessageId);
            if (already !== null) {
                this.logger.warn(`sendEmail hit a transient failure for company ${companyId} but the ` +
                    `message was delivered (${ownMessageId}); not resending`);
                return already;
            }
            this.logger.warn(`sendEmail hit a transient failure for company ${companyId}; ` +
                `${ownMessageId} is absent from the mailbox, retrying once`);
            const res = await issueSend(gmail);
            return res.data.id ?? null;
        }
    }
    async findSentByMessageId(gmail, ownMessageId) {
        try {
            const res = await gmail.users.messages.list({
                userId: 'me',
                maxResults: 1,
                q: `rfc822msgid:${ownMessageId.replace(/^<|>$/g, '')}`,
            });
            const hit = res.data.messages?.[0]?.id;
            if (hit)
                return hit;
            return res.data.messages?.length ? '' : null;
        }
        catch (lookupErr) {
            this.logger.warn(`could not verify whether ${ownMessageId} was sent: ` +
                `${lookupErr instanceof Error ? lookupErr.message : String(lookupErr)}` +
                ' — assuming it was, to avoid sending a duplicate');
            return '';
        }
    }
    async markAsUnread(companyId, messageId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: { addLabelIds: ['UNREAD'] },
        });
        this.bustUnread(companyId);
    }
    async sendChatMessage(companyId, dto) {
        const account = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
            select: { scope: true, chatUserId: true, gmailAddress: true },
        });
        const hasChatScope = grantsChatSend(account?.scope);
        const canOpenSpaces = grantsSpacesSetup(account?.scope);
        const auth = await this.ensureFreshTokens(companyId);
        const chat = googleapis_1.google.chat({ version: 'v1', auth });
        const doSend = async () => {
            const res = await chat.spaces.messages.create({
                parent: dto.spaceId,
                requestBody: {
                    text: dto.text,
                    ...(dto.quotedMessageName && dto.quotedMessageLastUpdateTime
                        ? {
                            quotedMessageMetadata: {
                                name: dto.quotedMessageName,
                                lastUpdateTime: dto.quotedMessageLastUpdateTime,
                            },
                        }
                        : {}),
                },
            });
            return {
                id: res.data.name ?? '',
                spaceId: dto.spaceId,
                sender: 'You',
                text: res.data.text ?? dto.text,
                createTime: res.data.createTime ?? new Date().toISOString(),
                lastUpdateTime: res.data.lastUpdateTime ??
                    res.data.createTime ??
                    new Date().toISOString(),
                quotedMessageName: res.data.quotedMessageMetadata?.name ?? null,
            };
        };
        const extractStatus = (err) => {
            const e = err;
            return (e.response?.status ?? Number(e.code ?? e.status ?? 0)) || 0;
        };
        const isFailedPrecondition = (err) => {
            const e = err;
            const msg = String(e.message ?? '').toLowerCase();
            return (e.cause?.status === 'FAILED_PRECONDITION' ||
                msg.includes('failed_precondition'));
        };
        try {
            return await doSend();
        }
        catch (err) {
            const status = extractStatus(err);
            const detail = err.message ?? 'unknown error';
            const looksNotActivated = status === 403 ||
                status === 404 ||
                (status === 400 && isFailedPrecondition(err));
            if (looksNotActivated && hasChatScope && canOpenSpaces) {
                console.warn('[Gmail] chat send failed — attempting to auto-open the DM to activate Chat. granted scope:', account?.scope);
                const opened = await this.tryOpenDmSpace(chat, dto.spaceId, account?.chatUserId ?? null).catch(() => false);
                if (opened) {
                    try {
                        return await doSend();
                    }
                    catch {
                    }
                }
            }
            if (status === 403 || status === 401 || looksNotActivated) {
                console.warn('[Gmail] chat send rejected — granted scope:', account?.scope);
                if (!hasChatScope) {
                    throw new common_1.BadRequestException("This account hasn't granted permission to send chat messages — it was likely connected before chat replies were enabled. " +
                        'Disconnect and reconnect the account, and approve the chat permission when Google asks.');
                }
                if (!canOpenSpaces) {
                    throw new common_1.BadRequestException('Google Chat needs to be activated for this account. Disconnect and reconnect the account ' +
                        '(approve the chat permission when Google asks) to enable automatic activation, then try again.');
                }
                throw new common_1.BadRequestException("Google Chat isn't activated for this account yet. Open Google Chat once " +
                    `(in Gmail, or at chat.google.com) with ${account?.gmailAddress ?? 'this account'}, then try replying again. (${detail})`);
            }
            throw new common_1.BadRequestException(detail);
        }
    }
    async tryOpenDmSpace(chat, spaceId, selfChatUserId) {
        const sp = await chat.spaces.get({ name: spaceId });
        if (sp.data.spaceType !== 'DIRECT_MESSAGE')
            return false;
        const self = selfChatUserId ? `users/${selfChatUserId}` : null;
        const members = await chat.spaces.members.list({
            parent: spaceId,
            pageSize: 100,
        });
        const other = (members.data.memberships ?? [])
            .map((m) => m.member)
            .find((mm) => mm?.type === 'HUMAN' && !!mm.name && mm.name !== self);
        if (!other?.name)
            return false;
        await chat.spaces.setup({
            requestBody: {
                space: { spaceType: 'DIRECT_MESSAGE' },
                memberships: [{ member: { name: other.name, type: 'HUMAN' } }],
            },
        });
        return true;
    }
    async disconnect(companyId) {
        const record = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
        });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected');
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        try {
            const accessToken = (0, crypto_util_js_1.decrypt)(record.accessToken, encKey);
            await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
                method: 'POST',
            });
        }
        catch {
        }
        await this.prisma.gmailAccount.delete({ where: { companyId } });
    }
    async handleWebhook(body) {
        if (!body.message?.data)
            return;
        const decoded = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8'));
        const record = await this.prisma.gmailAccount.findFirst({
            where: { gmailAddress: decoded.emailAddress },
        });
        if (!record)
            return;
        const newHistoryId = BigInt(decoded.historyId);
        await this.prisma.gmailAccount.update({
            where: { id: record.id },
            data: { lastHistoryId: newHistoryId },
        });
        this.state.bustUncompleted(record.companyId);
        this.bustUnread(record.companyId);
        this.broadcastNewEmail(record.companyId);
    }
    addSseClient(id, companyId, subject) {
        this.sseClients.set(id, { companyId, subject });
    }
    removeSseClient(id) {
        this.sseClients.delete(id);
    }
    async assertCanStream(companyId, userId) {
        await (0, company_access_util_js_1.assertOwnCompany)(this.prisma, companyId, userId);
    }
    broadcastNewEmail(companyId) {
        for (const [, client] of this.sseClients) {
            if (client.companyId === companyId) {
                client.subject.next({ data: JSON.stringify({ type: 'new-email' }) });
            }
        }
    }
};
exports.GmailService = GmailService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_MIDNIGHT),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], GmailService.prototype, "renewExpiringWatches", null);
exports.GmailService = GmailService = GmailService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        message_state_service_js_1.MessageStateService])
], GmailService);
//# sourceMappingURL=gmail.service.js.map