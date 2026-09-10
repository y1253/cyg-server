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
var UnreadFeedService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnreadFeedService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const gmail_service_js_1 = require("../gmail/gmail.service.js");
const microsoft_service_js_1 = require("../microsoft/microsoft.service.js");
const internal_messages_service_js_1 = require("../internal-messages/internal-messages.service.js");
const internal_calls_service_js_1 = require("../internal-calls/internal-calls.service.js");
const phone_timeline_service_js_1 = require("../phone/phone-timeline.service.js");
const company_access_util_js_1 = require("./company-access.util.js");
const pool_util_js_1 = require("./pool.util.js");
const unread_feed_types_js_1 = require("./unread-feed.types.js");
const unread_feed_util_js_1 = require("./unread-feed.util.js");
let UnreadFeedService = class UnreadFeedService {
    static { UnreadFeedService_1 = this; }
    prisma;
    gmail;
    microsoft;
    internal;
    internalCalls;
    phoneTimeline;
    logger = new common_1.Logger(UnreadFeedService_1.name);
    constructor(prisma, gmail, microsoft, internal, internalCalls, phoneTimeline) {
        this.prisma = prisma;
        this.gmail = gmail;
        this.microsoft = microsoft;
        this.internal = internal;
        this.internalCalls = internalCalls;
        this.phoneTimeline = phoneTimeline;
    }
    itemCache = new Map();
    inFlight = new Map();
    static TTL_MS = 55_000;
    static MAX_ENTRIES = 300;
    static CONCURRENCY = 4;
    async forUser(userId) {
        const companies = await (0, company_access_util_js_1.listOwnCompanies)(this.prisma, userId);
        const clients = companies.filter((c) => !c.isInternal);
        const workspace = companies.find((c) => c.isInternal) ?? null;
        const providers = await this.resolveProviders(clients.map((c) => c.id));
        const failed = [];
        const groups = [];
        const swept = await (0, pool_util_js_1.pool)(clients, UnreadFeedService_1.CONCURRENCY, (c) => this.companyItems(c.id, c.businessName, providers.get(c.id) ?? null));
        swept.forEach((result, i) => {
            const company = clients[i];
            if (result.failed) {
                failed.push({
                    companyId: company.id,
                    companyName: company.businessName,
                });
            }
            if (result.items.length > 0) {
                groups.push({ companyId: company.id, items: result.items });
            }
        });
        if (workspace) {
            const internalItems = await this.workspaceItems(userId, workspace.id, workspace.businessName);
            if (internalItems.length > 0) {
                groups.push({ companyId: workspace.id, items: internalItems });
            }
        }
        const { items, truncated } = (0, unread_feed_util_js_1.mergeUnreadFeed)(groups);
        return { items, truncated, failed };
    }
    async resolveProviders(ids) {
        const out = new Map();
        if (ids.length === 0)
            return out;
        const [google, microsoft] = await Promise.all([
            this.prisma.gmailAccount.findMany({
                where: { companyId: { in: ids } },
                select: { companyId: true },
            }),
            this.prisma.microsoftAccount.findMany({
                where: { companyId: { in: ids } },
                select: { companyId: true },
            }),
        ]);
        for (const row of google)
            out.set(row.companyId, this.gmail);
        for (const row of microsoft)
            out.set(row.companyId, this.microsoft);
        return out;
    }
    async companyItems(companyId, companyName, provider) {
        const cached = this.itemCache.get(companyId);
        if (cached && Date.now() - cached.at < UnreadFeedService_1.TTL_MS) {
            return { items: cached.items, failed: cached.failed };
        }
        const existing = this.inFlight.get(companyId);
        if (existing)
            return existing;
        const run = this.sweepCompany(companyId, companyName, provider)
            .then((result) => {
            this.remember(companyId, result);
            return result;
        })
            .finally(() => {
            this.inFlight.delete(companyId);
        });
        this.inFlight.set(companyId, run);
        return run;
    }
    async sweepCompany(companyId, companyName, provider) {
        const nowIso = new Date().toISOString();
        const items = [];
        let failed = false;
        const [emails, chats, phone] = await Promise.all([
            provider ? this.unreadEmails(companyId, provider) : null,
            provider ? this.unreadChats(companyId, provider) : null,
            this.unreadPhone(companyId),
        ]);
        if (emails === 'failed')
            failed = true;
        else if (emails) {
            items.push(...emails.map((e) => (0, unread_feed_util_js_1.emailToFeedItem)(companyId, companyName, e, nowIso)));
        }
        if (chats === 'failed')
            failed = true;
        else if (chats) {
            items.push(...chats.map((c) => (0, unread_feed_util_js_1.chatToFeedItem)(companyId, companyName, c, nowIso)));
        }
        if (phone === 'failed')
            failed = true;
        else {
            items.push(...phone.map((p) => (0, unread_feed_util_js_1.phoneToFeedItem)(companyId, companyName, p, nowIso)));
        }
        return { items, failed };
    }
    async unreadEmails(companyId, provider) {
        try {
            const result = await provider.getEmails(companyId, undefined, [
                'INBOX',
                'UNREAD',
            ]);
            if (result.needsReconnect)
                return 'failed';
            return result.messages.filter((m) => !m.isRead).slice(0, unread_feed_types_js_1.PER_COMPANY_CAP);
        }
        catch (err) {
            this.logger.warn(`unread emails failed for company ${companyId}: ${String(err)}`);
            return 'failed';
        }
    }
    async unreadChats(companyId, provider) {
        try {
            const result = await provider.getChats(companyId);
            if (result.needsReconnect)
                return 'failed';
            return result.messages.filter((m) => !m.isRead).slice(0, unread_feed_types_js_1.PER_COMPANY_CAP);
        }
        catch (err) {
            this.logger.warn(`unread chats failed for company ${companyId}: ${String(err)}`);
            return 'failed';
        }
    }
    async unreadPhone(companyId) {
        try {
            return await this.phoneTimeline.getUnreadItems(companyId, unread_feed_types_js_1.PER_COMPANY_CAP);
        }
        catch (err) {
            this.logger.warn(`unread phone failed for company ${companyId}: ${String(err)}`);
            return 'failed';
        }
    }
    async workspaceItems(userId, workspaceId, workspaceName) {
        const nowIso = new Date().toISOString();
        const [messages, calls] = await Promise.all([
            this.unreadInternalMessages(userId),
            this.unreadInternalCalls(userId),
        ]);
        return [
            ...messages
                .slice(0, unread_feed_types_js_1.PER_COMPANY_CAP)
                .map((m) => (0, unread_feed_util_js_1.internalMessageToFeedItem)(workspaceId, workspaceName, m, nowIso)),
            ...calls.map((c) => (0, unread_feed_util_js_1.internalCallToFeedItem)(workspaceId, workspaceName, c, nowIso)),
        ];
    }
    async unreadInternalMessages(userId) {
        try {
            const { messages } = await this.internal.list(userId, 'UNREAD');
            return messages;
        }
        catch (err) {
            this.logger.warn(`unread internal messages failed: ${String(err)}`);
            return [];
        }
    }
    async unreadInternalCalls(userId) {
        try {
            const { calls } = await this.internalCalls.list(userId, 'UNREAD', undefined, unread_feed_types_js_1.PER_COMPANY_CAP);
            return calls;
        }
        catch (err) {
            this.logger.warn(`unread internal calls failed: ${String(err)}`);
            return [];
        }
    }
    remember(companyId, result) {
        if (this.itemCache.size >= UnreadFeedService_1.MAX_ENTRIES) {
            const oldest = this.itemCache.keys().next();
            if (!oldest.done)
                this.itemCache.delete(oldest.value);
        }
        this.itemCache.set(companyId, { at: Date.now(), ...result });
    }
};
exports.UnreadFeedService = UnreadFeedService;
exports.UnreadFeedService = UnreadFeedService = UnreadFeedService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        gmail_service_js_1.GmailService,
        microsoft_service_js_1.MicrosoftService,
        internal_messages_service_js_1.InternalMessagesService,
        internal_calls_service_js_1.InternalCallsService,
        phone_timeline_service_js_1.PhoneTimelineService])
], UnreadFeedService);
//# sourceMappingURL=unread-feed.service.js.map