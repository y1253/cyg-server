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
const child_process_1 = require("child_process");
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const googleapis_1 = require("googleapis");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const encode_header_js_1 = require("./encode-header.js");
const crypto_util_js_1 = require("../communications/crypto.util.js");
const message_state_service_js_1 = require("../communications/message-state.service.js");
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
function getCallbackUrl() {
    return `${process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'}/api/gmail/callback`;
}
function makeOAuth2Client() {
    return new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_API_SECRET, getCallbackUrl());
}
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
            const rawCid = header('content-id');
            const contentId = rawCid ? rawCid.replace(/^<|>$/g, '') : null;
            const disposition = (header('content-disposition') ?? '')
                .trim()
                .toLowerCase();
            out.push({
                filename: part.filename,
                mimeType: part.mimeType ?? 'application/octet-stream',
                size: part.body?.size ?? 0,
                attachmentId,
                contentId,
                isInline: disposition.startsWith('inline') ||
                    (contentId !== null && referencedCids.has(contentId)),
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
    async ensureFreshTokens(companyId) {
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
        if (record.tokenExpiry <= new Date(Date.now() + 60 * 1000)) {
            const { credentials } = await oauth2Client.refreshAccessToken();
            if (credentials.access_token) {
                await this.prisma.gmailAccount.update({
                    where: { companyId },
                    data: {
                        accessToken: (0, crypto_util_js_1.encrypt)(credentials.access_token, encKey),
                        tokenExpiry: new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000),
                    },
                });
                oauth2Client.setCredentials(credentials);
            }
        }
        return oauth2Client;
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
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const isUncompleted = (labelIds ?? []).includes('UNCOMPLETED');
        let msgList;
        let nextPageToken;
        if (isUncompleted) {
            const ids = await this.getUncompletedEmailIds(companyId, q);
            const offset = pageToken ? parseInt(pageToken, 10) || 0 : 0;
            const slice = ids.slice(offset, offset + 50);
            msgList = slice.map((id) => ({ id }));
            nextPageToken = offset + 50 < ids.length ? String(offset + 50) : null;
        }
        else {
            const listRes = await gmail.users.messages.list({
                userId: 'me',
                maxResults: 50,
                pageToken,
                labelIds: labelIds ?? ['INBOX'],
                ...(q ? { q } : {}),
            });
            msgList = listRes.data.messages ?? [];
            nextPageToken = listRes.data.nextPageToken ?? null;
        }
        const completedSet = await this.state.getCompletedSet(companyId);
        const forwardedSet = await this.state.getForwardedSet(companyId);
        const messages = await Promise.all(msgList.map(async (m) => {
            const detail = await gmail.users.messages.get({
                userId: 'me',
                id: m.id,
                format: 'full',
            });
            const headers = detail.data.payload?.headers ?? [];
            const h = (name) => headers.find((x) => x.name === name)?.value ?? '';
            const labelIds = detail.data.labelIds ?? [];
            return {
                id: m.id,
                subject: h('Subject'),
                from: h('From'),
                date: h('Date'),
                snippet: detail.data.snippet ?? '',
                isRead: !labelIds.includes('UNREAD'),
                isCompleted: completedSet.has(m.id),
                isForwarded: forwardedSet.has(m.id),
                attachments: this.parseNonInlineAttachments(detail.data.payload),
            };
        }));
        return { messages, nextPageToken };
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
        const details = await Promise.all(ids.map((id) => gmail.users.messages.get({
            userId: 'me',
            id,
            format: 'metadata',
            metadataHeaders: ['From', 'To', 'Cc'],
        })));
        const byEmail = new Map();
        for (const d of details) {
            const headers = d.data.payload?.headers ?? [];
            for (const field of ['From', 'To', 'Cc']) {
                const raw = headers.find((x) => x.name === field)?.value ?? '';
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
            const spacesRes = await chat.spaces.list({ pageSize: 20 });
            const spaces = spacesRes.data.spaces ?? [];
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
            const readSet = await this.state.getReadSet(companyId);
            const completedSet = await this.state.getCompletedSet(companyId);
            const memberDisplayNames = new Map();
            await Promise.allSettled(targetSpaces.map(async (space) => {
                try {
                    const membersRes = await chat.spaces.members.list({
                        parent: space.name,
                        pageSize: 100,
                    });
                    for (const m of membersRes.data.memberships ?? []) {
                        if (m.member?.name && m.member.displayName) {
                            memberDisplayNames.set(m.member.name, m.member.displayName);
                        }
                    }
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
                        .list({ ...listArgs, orderBy: 'createTime DESC' })
                        .catch(() => chat.spaces.messages.list(listArgs));
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
    referencedCidsFromHtml(bodyHtml) {
        const referencedCids = new Set();
        for (const m of (bodyHtml ?? '').matchAll(/cid:([^"'>\s)]+)/gi)) {
            referencedCids.add(m[1]);
            try {
                referencedCids.add(decodeURIComponent(m[1]));
            }
            catch {
            }
        }
        return referencedCids;
    }
    parseNonInlineAttachments(payload) {
        const p = payload;
        const bodyHtml = extractPart(p, 'text/html');
        const referencedCids = this.referencedCidsFromHtml(bodyHtml);
        return extractAttachments(p, referencedCids).filter((a) => !a.isInline);
    }
    async getEmail(companyId, messageId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
        });
        const headers = res.data.payload?.headers ?? [];
        const h = (name) => headers.find((x) => x.name === name)?.value ?? '';
        const payload = res.data.payload;
        const bodyHtml = extractPart(payload, 'text/html');
        const bodyText = extractPart(payload, 'text/plain');
        const referencedCids = this.referencedCidsFromHtml(bodyHtml);
        const attachments = extractAttachments(payload, referencedCids);
        const forwardRows = await this.state.getForwards(companyId, messageId);
        return {
            id: messageId,
            threadId: res.data.threadId ?? '',
            messageId: h('Message-ID'),
            subject: h('Subject'),
            from: h('From'),
            to: h('To'),
            date: h('Date'),
            snippet: res.data.snippet ?? '',
            bodyHtml,
            bodyText,
            attachments,
            isForwarded: forwardRows.length > 0,
            forwards: forwardRows.map((r) => ({
                to: r.recipient ?? '',
                at: r.forwardedAt.toISOString(),
            })),
        };
    }
    async getEmailAttachment(companyId, messageId, attachmentId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId,
            id: attachmentId,
        });
        return Buffer.from(res.data.data ?? '', 'base64url');
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
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const headers = [
            `To: ${dto.to}`,
            ...(dto.cc ? [`Cc: ${dto.cc}`] : []),
            `Subject: ${(0, encode_header_js_1.encodeHeaderWord)(dto.subject ?? '')}`,
            ...(dto.inReplyTo
                ? [`In-Reply-To: ${dto.inReplyTo}`, `References: ${dto.inReplyTo}`]
                : []),
            'MIME-Version: 1.0',
        ];
        const b64wrap = (input) => (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8'))
            .toString('base64')
            .replace(/(.{76})/g, '$1\r\n');
        const hasHtml = !!dto.bodyHtml && dto.bodyHtml.trim() !== '';
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
                b64wrap(dto.body),
                `--${altBoundary}`,
                'Content-Type: text/html; charset=utf-8',
                'Content-Transfer-Encoding: base64',
                '',
                b64wrap(dto.bodyHtml),
                `--${altBoundary}--`,
            ];
        }
        else {
            contentHeader = [
                'Content-Type: text/plain; charset=utf-8',
                'Content-Transfer-Encoding: base64',
            ];
            contentBody = [b64wrap(dto.body)];
        }
        let message;
        if (attachments.length === 0) {
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
            for (const f of attachments) {
                const { asciiName, filenameParam } = (0, encode_header_js_1.attachmentNameParams)(f.originalname);
                parts.push(`--${mixBoundary}`, `Content-Type: ${f.mimetype || 'application/octet-stream'}; name="${asciiName}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${asciiName}"${filenameParam}`, '', b64wrap(f.buffer));
            }
            parts.push(`--${mixBoundary}--`, '');
            message = [
                ...headers,
                `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
                '',
                ...parts,
            ].join('\r\n');
        }
        const raw = Buffer.from(message).toString('base64url');
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: { raw, ...(dto.threadId ? { threadId: dto.threadId } : {}) },
        });
        if (dto.forwardedFrom) {
            await this.state.recordForward(companyId, dto.forwardedFrom, dto.to);
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
        this.broadcastNewEmail(record.companyId);
    }
    addSseClient(id, companyId, subject) {
        this.sseClients.set(id, { companyId, subject });
    }
    removeSseClient(id) {
        this.sseClients.delete(id);
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