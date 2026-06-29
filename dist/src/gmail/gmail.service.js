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
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const googleapis_1 = require("googleapis");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const ALGORITHM = 'aes-256-cbc';
function encrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
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
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        throw new common_1.UnauthorizedException('Invalid state signature');
    }
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (Date.now() - parsed.ts > 10 * 60 * 1000) {
        throw new common_1.UnauthorizedException('State expired');
    }
    return { companyId: parsed.companyId, userId: parsed.userId };
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
            scope: [
                'https://www.googleapis.com/auth/gmail.modify',
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/chat.spaces.readonly',
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
            },
            update: {
                gmailAddress,
                accessToken: encAccessToken,
                refreshToken: encRefreshToken,
                tokenExpiry,
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
        const record = await this.prisma.gmailAccount.findUnique({ where: { companyId } });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected for this company');
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        const accessToken = decrypt(record.accessToken, encKey);
        const refreshToken = decrypt(record.refreshToken, encKey);
        const oauth2Client = makeOAuth2Client();
        oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
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
        const record = await this.prisma.gmailAccount.findUnique({ where: { companyId } });
        if (!record)
            throw new common_1.NotFoundException('No Gmail account connected');
        return { gmailAddress: record.gmailAddress, connectedAt: record.connectedAt };
    }
    async getEmails(companyId, pageToken, labelIds) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            maxResults: 20,
            pageToken,
            labelIds: labelIds ?? ['INBOX'],
        });
        const msgList = listRes.data.messages ?? [];
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
            };
        }));
        return { messages, nextPageToken: listRes.data.nextPageToken ?? null };
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
    async getChats(companyId) {
        let auth;
        try {
            auth = await this.ensureFreshTokens(companyId);
        }
        catch {
            return { conversations: [], needsReconnect: true, chatStatus: 'needs_reconnect' };
        }
        try {
            const chat = googleapis_1.google.chat({ version: 'v1', auth });
            const spacesRes = await chat.spaces.list({ pageSize: 20 });
            const spaces = spacesRes.data.spaces ?? [];
            if (spaces.length === 0) {
                return { conversations: [], needsReconnect: false, chatStatus: 'no_spaces' };
            }
            const conversations = [];
            const readRows = await this.prisma.$queryRaw `
        SELECT spaceId, lastReadAt FROM ChatReadState WHERE companyId = ${companyId}
      `;
            const lastReadMap = new Map(readRows.map((r) => [r.spaceId, new Date(r.lastReadAt).getTime()]));
            const memberDisplayNames = new Map();
            await Promise.allSettled(spaces.map(async (space) => {
                try {
                    const membersRes = await chat.spaces.members.list({ parent: space.name, pageSize: 100 });
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
            for (const space of spaces) {
                const spaceType = space.spaceType ?? 'SPACE';
                const spaceName = space.displayName ||
                    (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
                try {
                    const msgsRes = await chat.spaces.messages.list({
                        parent: space.name,
                        pageSize: 10,
                    });
                    let lastMessage = null;
                    for (const msg of msgsRes.data.messages ?? []) {
                        const senderName = msg.sender?.displayName ||
                            (msg.sender?.name ? memberDisplayNames.get(msg.sender.name) : undefined) ||
                            'Unknown';
                        const candidate = {
                            id: msg.name ?? '',
                            spaceId: space.name ?? '',
                            spaceName,
                            spaceType,
                            sender: senderName,
                            text: msg.text ?? '',
                            createTime: msg.createTime ?? '',
                        };
                        if (!lastMessage ||
                            new Date(candidate.createTime).getTime() > new Date(lastMessage.createTime).getTime()) {
                            lastMessage = candidate;
                        }
                    }
                    const lastRead = lastReadMap.get(space.name ?? '');
                    const latestTime = lastMessage ? new Date(lastMessage.createTime).getTime() : 0;
                    const isRead = !lastMessage || (lastRead !== undefined && lastRead >= latestTime);
                    conversations.push({
                        spaceId: space.name ?? '',
                        spaceName,
                        spaceType,
                        lastMessage,
                        isRead,
                    });
                }
                catch (err) {
                    const spaceErr = err;
                    const spaceStatus = (spaceErr.response?.status ?? Number(spaceErr.code ?? 0)) || undefined;
                    console.error(`[Gmail] Failed to load messages for space ${space.name ?? '?'} type=${spaceType} (HTTP ${spaceStatus ?? '?'}):`, spaceErr.message ?? err);
                    if (!firstSpaceError)
                        firstSpaceError = { status: spaceStatus, message: spaceErr.message };
                    failedSpaces++;
                }
            }
            if (failedSpaces > 0 && failedSpaces === spaces.length) {
                if (firstSpaceError?.status === 403 || firstSpaceError?.status === 401) {
                    return { conversations: [], needsReconnect: true, chatStatus: 'needs_reconnect' };
                }
                if (firstSpaceError?.status === 404) {
                    return { conversations: [], needsReconnect: false, chatStatus: 'app_not_configured' };
                }
                return { conversations: [], needsReconnect: false, chatStatus: 'error' };
            }
            conversations.sort((a, b) => {
                const ta = a.lastMessage ? new Date(a.lastMessage.createTime).getTime() : 0;
                const tb = b.lastMessage ? new Date(b.lastMessage.createTime).getTime() : 0;
                return tb - ta;
            });
            return { conversations, needsReconnect: false, chatStatus: 'ok' };
        }
        catch (err) {
            console.error('[Gmail] getChats error:', err);
            const errAny = err;
            const httpStatus = (errAny.response?.status ?? Number(errAny.code ?? errAny.status ?? 0)) || undefined;
            if (httpStatus === 403 || httpStatus === 401) {
                return { conversations: [], needsReconnect: true, chatStatus: 'needs_reconnect' };
            }
            if (httpStatus === 404) {
                return { conversations: [], needsReconnect: false, chatStatus: 'app_not_configured' };
            }
            const isChatDisabled = errAny.cause?.status === 'FAILED_PRECONDITION' ||
                String(errAny.message ?? '').toLowerCase().includes('chat is turned off') ||
                String(errAny.message ?? '').toLowerCase().includes('failed_precondition');
            if (httpStatus === 400 && isChatDisabled) {
                return { conversations: [], needsReconnect: false, chatStatus: 'chat_disabled' };
            }
            return { conversations: [], needsReconnect: false, chatStatus: 'error' };
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
            const membersRes = await chat.spaces.members.list({ parent: spaceId, pageSize: 100 });
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
        const msgsRes = await chat.spaces.messages.list({ parent: spaceId, pageSize: 50, pageToken });
        const messages = (msgsRes.data.messages ?? []).map((msg) => ({
            id: msg.name ?? '',
            spaceId,
            spaceName,
            spaceType,
            sender: msg.sender?.displayName ||
                (msg.sender?.name ? memberDisplayNames.get(msg.sender.name) : undefined) ||
                'Unknown',
            text: msg.text ?? '',
            createTime: msg.createTime ?? '',
        }));
        messages.sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime());
        return {
            messages,
            nextPageToken: msgsRes.data.nextPageToken ?? null,
            spaceName,
            spaceType,
        };
    }
    async markChatRead(companyId, spaceId) {
        const now = new Date();
        await this.prisma.$executeRaw `
      INSERT INTO ChatReadState (companyId, spaceId, lastReadAt, updatedAt)
      VALUES (${companyId}, ${spaceId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE lastReadAt = VALUES(lastReadAt), updatedAt = VALUES(updatedAt)
    `;
    }
    async markChatUnread(companyId, spaceId) {
        await this.prisma.$executeRaw `
      DELETE FROM ChatReadState WHERE companyId = ${companyId} AND spaceId = ${spaceId}
    `;
    }
    async getUnreadCount(companyId) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const res = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
        return { count: res.data.messagesUnread ?? 0 };
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
        };
    }
    async sendEmail(companyId, dto) {
        const auth = await this.ensureFreshTokens(companyId);
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth });
        const lines = [
            `To: ${dto.to}`,
            ...(dto.cc ? [`Cc: ${dto.cc}`] : []),
            `Subject: ${dto.subject}`,
            ...(dto.inReplyTo ? [`In-Reply-To: ${dto.inReplyTo}`, `References: ${dto.inReplyTo}`] : []),
            'Content-Type: text/plain; charset=utf-8',
            '',
            dto.body,
        ];
        const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
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
        const auth = await this.ensureFreshTokens(companyId);
        const chat = googleapis_1.google.chat({ version: 'v1', auth });
        try {
            await chat.spaces.messages.create({
                parent: dto.spaceId,
                requestBody: { text: dto.text },
            });
        }
        catch (err) {
            const errAny = err;
            const status = (errAny.response?.status ?? 0);
            if (status === 403) {
                throw new common_1.BadRequestException('Cannot send message: the Gmail account does not have chat messaging permission. ' +
                    'In Google Cloud Console → OAuth consent screen, add the "chat.messages" scope, then reconnect Gmail.');
            }
            throw new common_1.BadRequestException(errAny.message ?? 'Failed to send Chat message');
        }
    }
    async disconnect(companyId) {
        const record = await this.prisma.gmailAccount.findUnique({ where: { companyId } });
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