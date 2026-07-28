"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var MicrosoftService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrosoftService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const message_state_service_js_1 = require("../communications/message-state.service.js");
const crypto_util_js_1 = require("../communications/crypto.util.js");
const oauth_state_util_js_1 = require("../communications/oauth-state.util.js");
const msal_util_js_1 = require("./msal.util.js");
const graph_util_js_1 = require("./graph.util.js");
const draft_body_util_js_1 = require("./draft-body.util.js");
async function pool(items, concurrency, fn) {
    const out = new Array(items.length);
    let cursor = 0;
    const worker = async () => {
        while (cursor < items.length) {
            const i = cursor++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return out;
}
const SPACE_CAP = 20;
const MSG_PER_SPACE = 15;
const EMAIL_SELECT = 'id,subject,from,sender,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,conversationId,internetMessageId';
const ATTACH_EXPAND = 'attachments($select=id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId)';
let MicrosoftService = MicrosoftService_1 = class MicrosoftService {
    prisma;
    state;
    providerKind = 'MICROSOFT';
    logger = new common_1.Logger(MicrosoftService_1.name);
    constructor(prisma, state) {
        this.prisma = prisma;
        this.state = state;
    }
    stateKey(m) {
        return m.internetMessageId ?? m.id;
    }
    isMarked(set, m) {
        return set.has(this.stateKey(m)) || set.has(m.id);
    }
    async upgradeLegacyCompletedKeys(companyId, msgs, completedSet) {
        const stale = msgs.filter((m) => m.internetMessageId &&
            !completedSet.has(m.internetMessageId) &&
            completedSet.has(m.id));
        if (stale.length === 0)
            return;
        try {
            const written = await this.state.flushCompleted(companyId, stale.map((m) => this.stateKey(m)));
            this.logger.log(`[Microsoft] re-keyed ${written} completed rows to Message-ID for company ${companyId}`);
        }
        catch (err) {
            this.logger.warn(`re-key of completed rows failed for company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async forwardsFor(companyId, m) {
        const rows = await this.state.getForwards(companyId, this.stateKey(m));
        if (rows.length > 0 || this.stateKey(m) === m.id)
            return rows;
        return this.state.getForwards(companyId, m.id);
    }
    async stateKeyForId(companyId, graphId) {
        if (graphId.startsWith(graph_util_js_1.TEAMS_PREFIX))
            return graphId;
        try {
            const m = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/messages/${graphId}?$select=id,internetMessageId`));
            return this.stateKey(m);
        }
        catch (err) {
            this.logger.warn(`stateKeyForId(company=${companyId}) failed, using raw id: ${err instanceof Error ? err.message : String(err)}`);
            return graphId;
        }
    }
    logGraphFailure(op, companyId, err) {
        if (err instanceof graph_util_js_1.GraphError) {
            this.logger.error(`${op} failed for company ${companyId}: Graph ${err.status} ${err.graphCode ?? ''} — ${err.message}`);
            return err.status === 401 || err.status === 403;
        }
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`${op} failed for company ${companyId}: ${message}`);
        return !(err instanceof common_1.NotFoundException);
    }
    async generateAuthUrl(companyId, userId, kind = 'work') {
        const authUrl = await (0, msal_util_js_1.buildMicrosoftAuthUrl)((0, oauth_state_util_js_1.generateOAuthState)(companyId, userId, { kind }), kind);
        return { authUrl };
    }
    async handleCallback(code, state) {
        const { companyId, kind } = (0, oauth_state_util_js_1.verifyOAuthState)(state);
        const connectKind = kind === 'personal' ? 'personal' : 'work';
        const tokens = await (0, msal_util_js_1.redeemMicrosoftCode)(code, connectKind);
        if (!tokens.accessToken || !tokens.refreshToken) {
            throw new common_1.BadRequestException('Missing tokens from Microsoft');
        }
        if (!tokens.email) {
            throw new common_1.BadRequestException('Could not read Microsoft email address');
        }
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        const scope = tokens.scopes.join(' ');
        const data = {
            emailAddress: tokens.email,
            accessToken: (0, crypto_util_js_1.encrypt)(tokens.accessToken, encKey),
            refreshToken: (0, crypto_util_js_1.encrypt)(tokens.refreshToken, encKey),
            tokenExpiry: tokens.expiresOn,
            msUserId: tokens.userId,
            scope,
        };
        await this.prisma.microsoftAccount.upsert({
            where: { companyId },
            create: { companyId, ...data },
            update: data,
        });
        await this.prisma.gmailAccount.deleteMany({ where: { companyId } });
        this.state.bustUncompleted(companyId);
        void this.markExistingAsCompletedOnConnect(companyId).catch(() => undefined);
        return companyId;
    }
    refreshInFlight = new Map();
    async getAccessToken(companyId, forceRefresh = false) {
        const record = await this.prisma.microsoftAccount.findUnique({
            where: { companyId },
        });
        if (!record) {
            throw new common_1.NotFoundException('No Microsoft account connected for this company');
        }
        const encKey = process.env.ENCRYPTION_KEY ?? '';
        if (!forceRefresh &&
            record.tokenExpiry > new Date(Date.now() + 60 * 1000)) {
            return (0, crypto_util_js_1.decrypt)(record.accessToken, encKey);
        }
        const existing = this.refreshInFlight.get(companyId);
        if (existing)
            return existing;
        const refreshToken = (0, crypto_util_js_1.decrypt)(record.refreshToken, encKey);
        const grantedScope = (record.scope ?? '').toLowerCase();
        const hasTeams = grantedScope.includes('chat.readwrite') ||
            grantedScope.includes('chatmessage.send');
        const refreshScopes = (0, msal_util_js_1.scopesFor)(hasTeams ? 'work' : 'personal');
        const refreshPromise = (async () => {
            const tokens = await (0, msal_util_js_1.refreshMicrosoftTokens)(refreshToken, refreshScopes);
            await this.prisma.microsoftAccount.update({
                where: { companyId },
                data: {
                    accessToken: (0, crypto_util_js_1.encrypt)(tokens.accessToken, encKey),
                    tokenExpiry: tokens.expiresOn,
                    ...(tokens.refreshToken
                        ? { refreshToken: (0, crypto_util_js_1.encrypt)(tokens.refreshToken, encKey) }
                        : {}),
                },
            });
            return tokens.accessToken;
        })().finally(() => this.refreshInFlight.delete(companyId));
        this.refreshInFlight.set(companyId, refreshPromise);
        return refreshPromise;
    }
    async withGraph(companyId, fn) {
        const token = await this.getAccessToken(companyId);
        try {
            return await fn(token);
        }
        catch (err) {
            if (err instanceof graph_util_js_1.GraphError && err.status === 401) {
                const fresh = await this.getAccessToken(companyId, true);
                return await fn(fresh);
            }
            throw err;
        }
    }
    async getSelfUserId(companyId) {
        const rec = await this.prisma.microsoftAccount.findUnique({
            where: { companyId },
            select: { msUserId: true },
        });
        return rec?.msUserId ?? null;
    }
    async getAccount(companyId) {
        const record = await this.prisma.microsoftAccount.findUnique({
            where: { companyId },
        });
        if (!record)
            throw new common_1.NotFoundException('No Microsoft account connected');
        const scope = (record.scope ?? '').toLowerCase();
        return {
            provider: 'MICROSOFT',
            emailAddress: record.emailAddress,
            gmailAddress: record.emailAddress,
            connectedAt: record.connectedAt,
            hasChatScope: scope.includes('chatmessage.send') || scope.includes('chat.readwrite'),
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
    async getContacts(companyId) {
        const record = await this.prisma.microsoftAccount.findUnique({
            where: { companyId },
            select: { emailAddress: true },
        });
        const own = (record?.emailAddress ?? '').toLowerCase();
        const byEmail = new Map();
        const add = (a) => {
            const email = a?.emailAddress?.address?.trim().toLowerCase();
            if (!email || email === own)
                return;
            const name = a?.emailAddress?.name?.trim() ?? '';
            const existing = byEmail.get(email);
            if (!existing)
                byEmail.set(email, { email, name });
            else if (!existing.name && name)
                existing.name = name;
        };
        try {
            const [sent, inbox] = await Promise.all([
                this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/mailFolders/sentItems/messages?$top=50&$select=toRecipients,ccRecipients`)),
                this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/mailFolders/inbox/messages?$top=50&$select=from,toRecipients`)),
            ]);
            for (const m of sent.value) {
                (m.toRecipients ?? []).forEach(add);
                m.ccRecipients?.forEach(add);
            }
            for (const m of inbox.value) {
                add(m.from);
                (m.toRecipients ?? []).forEach(add);
            }
        }
        catch {
        }
        return [...byEmail.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    }
    folderFor(labelIds) {
        const l = labelIds ?? [];
        if (l.includes('SENT'))
            return 'sentItems';
        if (l.includes('SPAM'))
            return 'junkEmail';
        if (l.includes('TRASH'))
            return 'deletedItems';
        return 'inbox';
    }
    mapEmailAttachments(attachments) {
        return (attachments ?? [])
            .filter((a) => !a['@odata.type'] || a['@odata.type'].includes('fileAttachment'))
            .map((a) => ({
            filename: a.name ?? 'attachment',
            mimeType: a.contentType ?? 'application/octet-stream',
            size: a.size ?? 0,
            attachmentId: a.id,
            contentId: a.contentId ?? null,
            isInline: !!a.isInline,
        }));
    }
    mapEmailSummary(m, completedSet, forwardedSet) {
        return {
            id: m.id,
            threadId: m.conversationId ?? '',
            subject: m.subject ?? '',
            from: (0, graph_util_js_1.formatGraphAddress)(m.from ?? m.sender),
            date: m.receivedDateTime ?? m.sentDateTime ?? '',
            snippet: m.bodyPreview ?? '',
            isRead: m.isRead ?? true,
            isCompleted: this.isMarked(completedSet, m),
            isForwarded: this.isMarked(forwardedSet, m),
            attachments: this.mapEmailAttachments(m.attachments).filter((a) => !a.isInline),
        };
    }
    async getEmails(companyId, pageToken, labelIds, q) {
        try {
            return await this.getEmailsCore(companyId, pageToken, labelIds, q);
        }
        catch (err) {
            if (this.logGraphFailure('getEmails', companyId, err)) {
                return { messages: [], nextPageToken: null, needsReconnect: true };
            }
            throw err;
        }
    }
    async getEmailsCore(companyId, pageToken, labelIds, q) {
        const completedSet = await this.state.getCompletedSet(companyId);
        const forwardedSet = await this.state.getForwardedSet(companyId);
        if ((labelIds ?? []).includes('UNCOMPLETED')) {
            const ids = await this.getUncompletedEmailIds(companyId, q);
            const offset = pageToken ? parseInt(pageToken, 10) || 0 : 0;
            const slice = ids.slice(offset, offset + 50);
            const messages = await pool(slice, 5, (id) => this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/messages/${id}?$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`)).then((m) => this.mapEmailSummary(m, completedSet, forwardedSet)));
            const nextPageToken = offset + 50 < ids.length ? String(offset + 50) : null;
            return { messages, nextPageToken };
        }
        const folder = this.folderFor(labelIds);
        const orderField = folder === 'sentItems' ? 'sentDateTime' : 'receivedDateTime';
        let url;
        if (pageToken) {
            url = pageToken;
        }
        else if (q) {
            url =
                `/me/mailFolders/${folder}/messages?$search="${encodeURIComponent(q)}"` +
                    `&$top=50&$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`;
        }
        else if ((labelIds ?? []).includes('UNREAD')) {
            url =
                `/me/mailFolders/${folder}/messages?$filter=isRead eq false` +
                    `&$top=50&$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`;
        }
        else {
            url =
                `/me/mailFolders/${folder}/messages?$orderby=${orderField} desc` +
                    `&$top=50&$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`;
        }
        const res = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, url));
        await this.upgradeLegacyCompletedKeys(companyId, res.value, completedSet);
        const messages = res.value.map((m) => this.mapEmailSummary(m, completedSet, forwardedSet));
        return { messages, nextPageToken: res['@odata.nextLink'] ?? null };
    }
    async getEmail(companyId, messageId, immutable = false) {
        const prefer = [
            'outlook.body-content-type="html"',
            ...(immutable ? ['IdType="ImmutableId"'] : []),
        ].join(', ');
        const m = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/messages/${messageId}?$select=${EMAIL_SELECT},body&$expand=${ATTACH_EXPAND}`, { Prefer: prefer }));
        const completedSet = await this.state.getCompletedSet(companyId);
        const forwardedSet = await this.state.getForwardedSet(companyId);
        const forwardRows = await this.forwardsFor(companyId, m);
        return this.mapGraphMessageToDetail(m, completedSet, forwardedSet, forwardRows);
    }
    async getEmailThread(companyId, threadId) {
        const escaped = threadId.replace(/'/g, "''");
        const res = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/messages?$filter=conversationId eq '${encodeURIComponent(escaped)}'` +
            `&$top=50&$select=${EMAIL_SELECT},body&$expand=${ATTACH_EXPAND}`, { Prefer: 'outlook.body-content-type="html"' }));
        const completedSet = await this.state.getCompletedSet(companyId);
        const forwardedSet = await this.state.getForwardedSet(companyId);
        const sorted = [...res.value].sort((a, b) => {
            const da = a.receivedDateTime ?? a.sentDateTime ?? '';
            const db = b.receivedDateTime ?? b.sentDateTime ?? '';
            return da < db ? -1 : da > db ? 1 : 0;
        });
        const messages = await Promise.all(sorted.map(async (m) => {
            const forwardRows = await this.forwardsFor(companyId, m);
            return this.mapGraphMessageToDetail(m, completedSet, forwardedSet, forwardRows);
        }));
        return { messages };
    }
    mapGraphMessageToDetail(m, completedSet, forwardedSet, forwardRows) {
        const isHtml = (m.body?.contentType ?? '').toLowerCase() === 'html';
        return {
            id: m.id,
            threadId: m.conversationId ?? '',
            messageId: this.stateKey(m),
            subject: m.subject ?? '',
            from: (0, graph_util_js_1.formatGraphAddress)(m.from ?? m.sender),
            to: (0, graph_util_js_1.formatGraphAddressList)(m.toRecipients),
            date: m.receivedDateTime ?? m.sentDateTime ?? '',
            snippet: m.bodyPreview ?? '',
            bodyHtml: isHtml ? (m.body?.content ?? null) : null,
            bodyText: !isHtml ? (m.body?.content ?? null) : null,
            attachments: this.mapEmailAttachments(m.attachments),
            isRead: m.isRead ?? true,
            isCompleted: this.isMarked(completedSet, m),
            isForwarded: this.isMarked(forwardedSet, m),
            forwards: forwardRows.map((r) => ({
                to: r.recipient ?? '',
                at: r.forwardedAt.toISOString(),
                messageId: r.sentMessageId ?? null,
            })),
        };
    }
    async getEmailAttachment(companyId, messageId, attachmentId) {
        return this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGetBinary)(t, `/me/messages/${messageId}/attachments/${attachmentId}/$value`));
    }
    async markAsRead(companyId, messageId) {
        const token = await this.getAccessToken(companyId);
        await (0, graph_util_js_1.graphPatch)(token, `/me/messages/${messageId}`, { isRead: true });
    }
    async markAsUnread(companyId, messageId) {
        const token = await this.getAccessToken(companyId);
        await (0, graph_util_js_1.graphPatch)(token, `/me/messages/${messageId}`, { isRead: false });
    }
    parseRecipients(list) {
        return (list ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((address) => ({ emailAddress: { address } }));
    }
    buildGraphMessage(dto, attachments) {
        return {
            subject: dto.subject ?? '',
            body: {
                contentType: dto.bodyHtml ? 'html' : 'text',
                content: dto.bodyHtml ?? dto.body,
            },
            toRecipients: this.parseRecipients(dto.to),
            ccRecipients: this.parseRecipients(dto.cc),
            attachments: attachments.map((f) => ({
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: f.originalname,
                contentType: f.mimetype,
                contentBytes: f.buffer.toString('base64'),
            })),
        };
    }
    async addDraftAttachment(token, draftId, f) {
        const INLINE_MAX = 3 * 1024 * 1024;
        if (f.buffer.length <= INLINE_MAX) {
            await (0, graph_util_js_1.graphPost)(token, `/me/messages/${draftId}/attachments`, {
                '@odata.type': '#microsoft.graph.fileAttachment',
                name: f.originalname,
                contentType: f.mimetype,
                contentBytes: f.buffer.toString('base64'),
            });
            return;
        }
        const session = await (0, graph_util_js_1.graphPost)(token, `/me/messages/${draftId}/attachments/createUploadSession`, {
            AttachmentItem: {
                attachmentType: 'file',
                name: f.originalname,
                size: f.buffer.length,
                contentType: f.mimetype,
            },
        });
        const uploadUrl = session?.uploadUrl;
        if (!uploadUrl) {
            throw new Error(`Graph returned no uploadUrl for "${f.originalname}"`);
        }
        const CHUNK = 320 * 1024 * 10;
        const total = f.buffer.length;
        for (let start = 0; start < total; start += CHUNK) {
            const end = Math.min(start + CHUNK, total) - 1;
            const res = await fetch(uploadUrl, {
                method: 'PUT',
                headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
                body: new Uint8Array(f.buffer.subarray(start, end + 1)),
            });
            if (!res.ok) {
                throw new Error(`Attachment upload failed for "${f.originalname}" (${res.status})`);
            }
        }
    }
    async sendViaDraft(companyId, token, sourceId, action, dto, attachments) {
        let draft;
        try {
            draft = await (0, graph_util_js_1.graphPost)(token, `/me/messages/${sourceId}/${action}`, {}, { Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"' });
        }
        catch (err) {
            this.logger.warn(`${action} failed for company ${companyId}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
        if (!draft?.id)
            return null;
        const userHtml = dto.bodyHtml ?? (0, draft_body_util_js_1.textToHtml)(dto.body);
        await (0, graph_util_js_1.graphPatch)(token, `/me/messages/${draft.id}`, {
            subject: dto.subject ?? draft.subject ?? '',
            body: {
                contentType: 'html',
                content: (0, draft_body_util_js_1.insertAboveQuote)(userHtml, draft.body?.content ?? ''),
            },
            toRecipients: this.parseRecipients(dto.to),
            ccRecipients: this.parseRecipients(dto.cc),
        }, { Prefer: 'IdType="ImmutableId"' });
        for (const f of attachments) {
            await this.addDraftAttachment(token, draft.id, f);
        }
        await (0, graph_util_js_1.graphPost)(token, `/me/messages/${draft.id}/send`, {});
        return draft.id;
    }
    async sendEmail(companyId, dto, attachments = []) {
        const token = await this.getAccessToken(companyId);
        const message = this.buildGraphMessage(dto, attachments);
        if (dto.replyToMessageId) {
            const sentId = await this.sendViaDraft(companyId, token, dto.replyToMessageId, 'createReply', dto, attachments);
            if (sentId)
                return;
        }
        if (dto.forwardedFrom) {
            const sentId = await this.sendViaDraft(companyId, token, dto.forwardedFrom, 'createForward', dto, attachments);
            if (!sentId) {
                throw new common_1.BadRequestException("Couldn't load the original message to forward. It may have been " +
                    'moved or deleted in Outlook — reopen the message and try again.');
            }
            await this.state.recordForward(companyId, await this.stateKeyForId(companyId, dto.forwardedFrom), dto.to, sentId);
            return;
        }
        await (0, graph_util_js_1.graphPost)(token, '/me/sendMail', {
            message,
            saveToSentItems: true,
        });
    }
    async getChats(companyId) {
        const empty = (chatStatus, needsReconnect = false) => ({
            messages: [],
            needsReconnect,
            chatStatus,
            senderNamesUnavailable: null,
            nextCursor: null,
            hasMore: false,
        });
        let selfId;
        try {
            await this.getAccessToken(companyId);
            selfId = await this.getSelfUserId(companyId);
        }
        catch (err) {
            this.logGraphFailure('getChats(token)', companyId, err);
            return empty('needs_reconnect', true);
        }
        try {
            const readSet = await this.state.getReadSet(companyId);
            const completedSet = await this.state.getCompletedSet(companyId);
            const chatsRes = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/chats?$expand=members&$top=${SPACE_CAP}`));
            const chats = chatsRes.value;
            if (chats.length === 0)
                return empty('no_spaces');
            const perChat = await pool(chats, 4, async (chat) => {
                try {
                    const msgs = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/chats/${chat.id}/messages?$top=${MSG_PER_SPACE}`));
                    return { chat, messages: msgs.value };
                }
                catch {
                    return { chat, messages: [] };
                }
            });
            const rows = [];
            for (const { chat, messages } of perChat) {
                const spaceName = (0, graph_util_js_1.chatDisplayName)(chat, selfId);
                const spaceType = (0, graph_util_js_1.chatSpaceType)(chat.chatType);
                for (const m of messages) {
                    if (m.messageType && m.messageType !== 'message')
                        continue;
                    const senderId = m.from?.user?.id;
                    if (senderId && senderId === selfId)
                        continue;
                    const text = (0, graph_util_js_1.htmlToText)(m.body?.content);
                    if (!text && !(m.attachments?.length ?? 0))
                        continue;
                    const id = (0, graph_util_js_1.teamsStateId)(chat.id, m.id);
                    rows.push({
                        id,
                        spaceId: chat.id,
                        spaceName,
                        spaceType,
                        sender: m.from?.user?.displayName ?? 'Unknown',
                        text,
                        createTime: m.createdDateTime ?? '',
                        lastUpdateTime: m.lastModifiedDateTime ?? m.createdDateTime ?? '',
                        quotedMessageName: null,
                        isRead: readSet.has(id),
                        isCompleted: completedSet.has(id),
                        hasAttachments: (m.attachments?.length ?? 0) > 0,
                    });
                }
            }
            rows.sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
            return {
                messages: rows,
                needsReconnect: false,
                chatStatus: rows.length ? 'ok' : 'no_spaces',
                senderNamesUnavailable: null,
                nextCursor: null,
                hasMore: false,
            };
        }
        catch (err) {
            this.logGraphFailure('getChats', companyId, err);
            if (err instanceof graph_util_js_1.GraphError) {
                if (err.status === 403 && /license/i.test(err.message)) {
                    return empty('no_license');
                }
                if (err.status === 401 || err.status === 403) {
                    return empty('chat_disabled', true);
                }
            }
            return empty('error');
        }
    }
    async getChatThread(companyId, spaceId, pageToken) {
        let selfId;
        try {
            await this.getAccessToken(companyId);
            selfId = await this.getSelfUserId(companyId);
        }
        catch {
            return { messages: [], nextPageToken: null, needsReconnect: true };
        }
        try {
            const chat = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/chats/${spaceId}?$expand=members`));
            const res = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, pageToken ?? `/me/chats/${spaceId}/messages?$top=50`));
            const spaceName = (0, graph_util_js_1.chatDisplayName)(chat, selfId);
            const spaceType = (0, graph_util_js_1.chatSpaceType)(chat.chatType);
            const messages = res.value
                .filter((m) => !m.messageType || m.messageType === 'message')
                .map((m) => ({
                id: (0, graph_util_js_1.teamsStateId)(spaceId, m.id),
                spaceId,
                spaceName,
                spaceType,
                sender: m.from?.user?.displayName ?? 'Unknown',
                text: (0, graph_util_js_1.htmlToText)(m.body?.content),
                createTime: m.createdDateTime ?? '',
                lastUpdateTime: m.lastModifiedDateTime ?? m.createdDateTime ?? '',
                quotedMessageName: null,
                isOwn: !!m.from?.user?.id && m.from.user.id === selfId,
                attachments: (m.attachments ?? [])
                    .filter((a) => a.contentUrl)
                    .map((a) => ({
                    name: a.name ?? 'attachment',
                    contentName: a.name ?? 'attachment',
                    contentType: a.contentType ?? 'application/octet-stream',
                    resourceName: null,
                    driveFileId: null,
                    thumbnailUri: a.thumbnailUrl ?? null,
                    downloadUri: a.contentUrl ?? null,
                    source: 'sharepoint',
                })),
            }))
                .reverse();
            return {
                messages,
                nextPageToken: res['@odata.nextLink'] ?? null,
                spaceName,
                spaceType,
            };
        }
        catch {
            return { messages: [], nextPageToken: null, needsReconnect: true };
        }
    }
    async getChatAttachment(companyId, resourceName) {
        return this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGetBinary)(t, `/${resourceName}/$value`));
    }
    async sendChatMessage(companyId, dto) {
        const token = await this.getAccessToken(companyId);
        let created = null;
        try {
            created = await (0, graph_util_js_1.graphPost)(token, `/me/chats/${dto.spaceId}/messages`, { body: { contentType: 'html', content: dto.text } });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to send message';
            throw new common_1.BadRequestException(msg);
        }
        const now = new Date().toISOString();
        return {
            id: created?.id
                ? (0, graph_util_js_1.teamsStateId)(dto.spaceId, created.id)
                : (0, graph_util_js_1.teamsStateId)(dto.spaceId, now),
            spaceId: dto.spaceId,
            sender: 'You',
            text: dto.text,
            createTime: created?.createdDateTime ?? now,
            lastUpdateTime: created?.lastModifiedDateTime ?? now,
            quotedMessageName: null,
        };
    }
    async markChatRead(companyId, messageId) {
        await this.state.markChatRead(companyId, messageId);
    }
    async markChatUnread(companyId, messageId) {
        await this.state.markChatUnread(companyId, messageId);
    }
    async markComplete(companyId, messageId) {
        await this.state.markComplete(companyId, await this.stateKeyForId(companyId, messageId));
    }
    async markUncomplete(companyId, messageId) {
        const key = await this.stateKeyForId(companyId, messageId);
        await this.state.markUncomplete(companyId, key);
        if (key !== messageId) {
            await this.state.markUncomplete(companyId, messageId);
        }
    }
    async getUnreadCount(companyId) {
        let emailUnread = 0;
        try {
            const folder = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, `/me/mailFolders/inbox?$select=unreadItemCount`));
            emailUnread = folder.unreadItemCount ?? 0;
        }
        catch {
        }
        let chatUnread = 0;
        try {
            const chats = await this.getChats(companyId);
            chatUnread = chats.messages.filter((m) => !m.isRead).length;
        }
        catch {
        }
        return { count: emailUnread + chatUnread };
    }
    async getUncompletedCount(companyId) {
        return this.state.getUncompletedCount(companyId, () => this.computeUncompletedCount(companyId));
    }
    async computeUncompletedCount(companyId) {
        let emailUncompleted = 0;
        try {
            emailUncompleted = (await this.getUncompletedEmailIds(companyId)).length;
        }
        catch {
        }
        let chatUncompleted = 0;
        try {
            const chats = await this.getChats(companyId);
            chatUncompleted = chats.messages.filter((m) => !m.isCompleted).length;
        }
        catch {
        }
        return emailUncompleted + chatUncompleted;
    }
    async getUncompletedEmailIds(companyId, q) {
        return this.state.getCachedEmailIds(companyId, q, async () => {
            const inbox = [];
            const MAX_PAGES = 40;
            let url = `/me/mailFolders/inbox/messages?$select=id,internetMessageId&$top=500` +
                (q
                    ? `&$search="${encodeURIComponent(q)}"`
                    : `&$orderby=receivedDateTime desc`);
            for (let page = 0; page < MAX_PAGES; page++) {
                const res = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, url));
                inbox.push(...res.value);
                const next = res['@odata.nextLink'];
                if (!next)
                    break;
                url = next;
            }
            const completedSet = await this.state.getCompletedSet(companyId);
            await this.upgradeLegacyCompletedKeys(companyId, inbox, completedSet);
            return inbox
                .filter((m) => !this.isMarked(completedSet, m) && !m.id.startsWith(graph_util_js_1.TEAMS_PREFIX))
                .map((m) => m.id);
        });
    }
    async getUncompletedCounts() {
        const accounts = await this.prisma.microsoftAccount.findMany({
            select: { companyId: true },
        });
        const ids = accounts.map((a) => a.companyId);
        const counts = {};
        await pool(ids, 4, async (companyId) => {
            try {
                const { count } = await this.getUncompletedCount(companyId);
                counts[companyId] = count;
            }
            catch (err) {
                console.error(`[microsoft] uncompleted count failed for company ${companyId}:`, err instanceof Error ? err.message : err);
            }
        });
        return counts;
    }
    async disconnect(companyId) {
        await this.prisma.microsoftAccount
            .delete({ where: { companyId } })
            .catch(() => undefined);
        this.state.bustUncompleted(companyId);
    }
    async markExistingAsCompletedOnConnect(companyId) {
        const readKeys = [];
        let url = `/me/mailFolders/inbox/messages?$select=id,internetMessageId&$filter=isRead eq true&$top=500`;
        for (let page = 0; page < 40; page++) {
            const res = await this.withGraph(companyId, (t) => (0, graph_util_js_1.graphGet)(t, url));
            for (const m of res.value)
                readKeys.push(this.stateKey(m));
            const next = res['@odata.nextLink'];
            if (!next)
                break;
            url = next;
        }
        const emailWritten = await this.state.flushCompleted(companyId, readKeys);
        let chatWritten = 0;
        try {
            const chats = await this.getChats(companyId);
            const chatIds = chats.messages.map((m) => m.id);
            chatWritten = await this.state.flushCompleted(companyId, chatIds);
        }
        catch {
        }
        this.state.bustUncompleted(companyId);
        console.log(`[Microsoft] Connect sweep for company ${companyId}: marked ${emailWritten} emails + ${chatWritten} chat messages as completed.`);
    }
};
exports.MicrosoftService = MicrosoftService;
exports.MicrosoftService = MicrosoftService = MicrosoftService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        message_state_service_js_1.MessageStateService])
], MicrosoftService);
//# sourceMappingURL=microsoft.service.js.map