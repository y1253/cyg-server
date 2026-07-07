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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const child_process_1 = require("child_process");
const ffmpeg_static_1 = __importDefault(require("ffmpeg-static"));
const googleapis_1 = require("googleapis");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const ALGORITHM = 'aes-256-cbc';
function encrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(text, 'utf8'),
        cipher.final(),
    ]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}
function decrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const [ivHex, encHex] = text.split(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(encHex, 'hex')),
        decipher.final(),
    ]).toString('utf8');
}
const CHAT_SEND_SCOPES = [
    'https://www.googleapis.com/auth/chat.messages',
    'https://www.googleapis.com/auth/chat.messages.create',
];
function grantsChatSend(scope) {
    const tokens = (scope ?? '').split(/\s+/);
    return CHAT_SEND_SCOPES.some((s) => tokens.includes(s));
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
let GmailService = class GmailService {
    prisma;
    sseClients = new Map();
    constructor(prisma) {
        this.prisma = prisma;
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
                'https://www.googleapis.com/auth/chat.spaces.readonly',
                'https://www.googleapis.com/auth/chat.memberships.readonly',
                'https://www.googleapis.com/auth/chat.messages',
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
        const encAccessToken = encrypt(tokens.access_token, encKey);
        const encRefreshToken = encrypt(tokens.refresh_token, encKey);
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
        void this.startWatch(companyId).catch(() => undefined);
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
        const accessToken = decrypt(record.accessToken, encKey);
        const refreshToken = decrypt(record.refreshToken, encKey);
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
                        accessToken: encrypt(credentials.access_token, encKey),
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
            'accounting department',
            ...(company?.supportNumber ? [company.supportNumber] : []),
            ...(sigEmail ? [sigEmail] : []),
            '',
            'accounting managed by CYG FINANCE (https://cygfinance.com)',
        ].join('\n');
        const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const html = '<div data-cyg-signature="1">' +
            [
                `<div>${esc(company?.businessName ?? '')}</div>`,
                `<div>accounting department</div>`,
                ...(company?.supportNumber
                    ? [`<div>${esc(company.supportNumber)}</div>`]
                    : []),
                ...(sigEmail ? [`<div>${esc(sigEmail)}</div>`] : []),
                '<div><br></div>',
                `<div><span style="font-size:0.85em">accounting managed by </span><a href="https://cygfinance.com" style="font-size:1.15em">CYG FINANCE</a></div>`,
            ].join('') +
            '</div>';
        return { plain, html };
    }
    async getEmails(companyId, pageToken, labelIds, q) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 20,
            pageToken,
            labelIds: labelIds ?? ['INBOX'],
            ...(q ? { q } : {}),
        });
        const msgList = listRes.data.messages ?? [];
        const completedRows = await this.prisma.$queryRaw `
      SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
    `;
        const completedSet = new Set(completedRows.map((r) => r.messageId));
        const messages = await Promise.all(msgList.map(async (m) => {
            const detail = await gmail.users.messages.get({
                userId: 'me',
                id: m.id,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date'],
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
            };
        }));
        return { messages, nextPageToken: listRes.data.nextPageToken ?? null };
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
            const acctRows = await this.prisma.$queryRaw `
        SELECT chatUserId FROM GmailAccount WHERE companyId = ${companyId} LIMIT 1
      `;
            const selfName = acctRows[0]?.chatUserId
                ? `users/${acctRows[0].chatUserId}`
                : null;
            const readRows = await this.prisma.$queryRaw `
        SELECT messageId FROM ChatMessageReadState WHERE companyId = ${companyId}
      `;
            const readSet = new Set(readRows.map((r) => r.messageId));
            const completedRows = await this.prisma.$queryRaw `
        SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
      `;
            const completedSet = new Set(completedRows.map((r) => r.messageId));
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
                catch {
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
                        pageSize: query ? 50 : 15,
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
                        const senderName = msg.sender?.displayName ||
                            (msg.sender?.name
                                ? memberDisplayNames.get(msg.sender.name)
                                : undefined) ||
                            'Unknown';
                        const id = msg.name ?? '';
                        const text = msg.text ?? '';
                        if (query &&
                            ![text, senderName, spaceName].some((s) => s.toLowerCase().includes(query))) {
                            continue;
                        }
                        messages.push({
                            id,
                            spaceId: space.name ?? '',
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
                        nextCursor: null,
                        hasMore: false,
                    };
                }
                if (firstSpaceError?.status === 404) {
                    return {
                        messages: [],
                        needsReconnect: false,
                        chatStatus: 'app_not_configured',
                        nextCursor: null,
                        hasMore: false,
                    };
                }
                return {
                    messages: [],
                    needsReconnect: false,
                    chatStatus: 'error',
                    nextCursor: null,
                    hasMore: false,
                };
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
                    nextCursor: null,
                    hasMore: false,
                };
            }
            if (httpStatus === 404) {
                return {
                    messages: [],
                    needsReconnect: false,
                    chatStatus: 'app_not_configured',
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
                    nextCursor: null,
                    hasMore: false,
                };
            }
            return {
                messages: [],
                needsReconnect: false,
                chatStatus: 'error',
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
      SELECT chatUserId FROM GmailAccount WHERE companyId = ${companyId} LIMIT 1
    `;
        const selfName = acctRows[0]?.chatUserId
            ? `users/${acctRows[0].chatUserId}`
            : null;
        const messages = (msgsRes.data.messages ?? []).map((msg) => ({
            id: msg.name ?? '',
            spaceId,
            spaceName,
            spaceType,
            sender: msg.sender?.displayName ||
                (msg.sender?.name
                    ? memberDisplayNames.get(msg.sender.name)
                    : undefined) ||
                'Unknown',
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
        const now = new Date();
        await this.prisma.$executeRaw `
      INSERT INTO ChatMessageReadState (companyId, messageId, readAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE readAt = VALUES(readAt), updatedAt = VALUES(updatedAt)
    `;
    }
    async markChatUnread(companyId, messageId) {
        await this.prisma.$executeRaw `
      DELETE FROM ChatMessageReadState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
    }
    async markComplete(companyId, messageId) {
        const now = new Date();
        await this.prisma.$executeRaw `
      INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
    `;
    }
    async markUncomplete(companyId, messageId) {
        await this.prisma.$executeRaw `
      DELETE FROM MessageCompletedState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
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
        const referencedCids = new Set();
        for (const m of (bodyHtml ?? '').matchAll(/cid:([^"'>\s)]+)/gi)) {
            referencedCids.add(m[1]);
            try {
                referencedCids.add(decodeURIComponent(m[1]));
            }
            catch {
            }
        }
        const attachments = extractAttachments(payload, referencedCids);
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
            `Subject: ${dto.subject ?? ''}`,
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
            contentHeader = ['Content-Type: text/plain; charset=utf-8'];
            contentBody = [dto.body];
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
                const name = (f.originalname || 'attachment').replace(/["\r\n\\]/g, '_');
                parts.push(`--${mixBoundary}`, `Content-Type: ${f.mimetype || 'application/octet-stream'}; name="${name}"`, 'Content-Transfer-Encoding: base64', `Content-Disposition: attachment; filename="${name}"`, '', b64wrap(f.buffer));
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
            select: { scope: true },
        });
        const hasChatScope = grantsChatSend(account?.scope);
        const auth = await this.ensureFreshTokens(companyId);
        const chat = googleapis_1.google.chat({ version: 'v1', auth });
        try {
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
        }
        catch (err) {
            const errAny = err;
            const status = (errAny.response?.status ??
                Number(errAny.code ?? errAny.status ?? 0)) ||
                0;
            const detail = errAny.message ?? 'unknown error';
            if (status === 403 || status === 401) {
                console.warn('[Gmail] chat send 403 — granted scope:', account?.scope);
                if (!hasChatScope) {
                    throw new common_1.BadRequestException("This account hasn't granted permission to send chat messages — it was likely connected before chat replies were enabled. " +
                        'Disconnect and reconnect the account, and approve the chat permission when Google asks.');
                }
                throw new common_1.BadRequestException('Google rejected the send for this account. Try reconnecting; if it persists, make sure the account ' +
                    `is still a member of this conversation. (${detail})`);
            }
            throw new common_1.BadRequestException(detail);
        }
    }
    async disconnect(companyId) {
        const record = await this.prisma.gmailAccount.findUnique({
            where: { companyId },
        });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected');
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        try {
            const accessToken = decrypt(record.accessToken, encKey);
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
exports.GmailService = GmailService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], GmailService);
//# sourceMappingURL=gmail.service.js.map