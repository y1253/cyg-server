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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommunicationsController = void 0;
const common_1 = require("@nestjs/common");
const gmail_service_js_1 = require("../gmail/gmail.service.js");
const microsoft_service_js_1 = require("../microsoft/microsoft.service.js");
const provider_resolver_service_js_1 = require("./provider-resolver.service.js");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const internal_messages_service_js_1 = require("../internal-messages/internal-messages.service.js");
const internal_calls_service_js_1 = require("../internal-calls/internal-calls.service.js");
const phone_timeline_service_js_1 = require("../phone/phone-timeline.service.js");
const company_access_util_js_1 = require("./company-access.util.js");
const unread_feed_service_js_1 = require("./unread-feed.service.js");
const whatsapp_messages_service_js_1 = require("../whatsapp/whatsapp-messages.service.js");
const message_state_service_js_1 = require("./message-state.service.js");
const complete_until_util_js_1 = require("./complete-until.util.js");
const ai_document_service_js_1 = require("../ai/ai-document.service.js");
const ai_config_js_1 = require("../ai/ai.config.js");
const document_kind_util_js_1 = require("../ai/document-kind.util.js");
const pool_util_js_1 = require("./pool.util.js");
const complete_until_dto_js_1 = require("./dto/complete-until.dto.js");
let CommunicationsController = class CommunicationsController {
    gmail;
    microsoft;
    resolver;
    internal;
    internalCalls;
    phoneTimeline;
    unreadFeed;
    prisma;
    whatsapp;
    state;
    aiDocuments;
    constructor(gmail, microsoft, resolver, internal, internalCalls, phoneTimeline, unreadFeed, prisma, whatsapp, state, aiDocuments) {
        this.gmail = gmail;
        this.microsoft = microsoft;
        this.resolver = resolver;
        this.internal = internal;
        this.internalCalls = internalCalls;
        this.phoneTimeline = phoneTimeline;
        this.unreadFeed = unreadFeed;
        this.prisma = prisma;
        this.whatsapp = whatsapp;
        this.state = state;
        this.aiDocuments = aiDocuments;
    }
    async account(companyId) {
        const provider = await this.resolver.resolve(companyId);
        if (!provider) {
            throw new common_1.NotFoundException('No communications account connected');
        }
        return provider.getAccount(companyId);
    }
    async latestPreview(companyId, req) {
        await (0, company_access_util_js_1.assertOwnCompany)(this.prisma, companyId, req.user.userId);
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            return null;
        return provider.getLatestPreview(companyId);
    }
    async inboxSummary(req) {
        const [g, m, p, w, workspace, internalCount, internalCallCounts, feed, missedPhone, ownCompanies,] = await Promise.all([
            this.gmail.getUncompletedCounts(),
            this.microsoft.getUncompletedCounts(),
            this.phoneTimeline.getUncompletedCountsForAll(),
            this.whatsapp.getUncompletedCountsForAll(),
            this.prisma.company.findUnique({
                where: { internalOwnerId: req.user.userId },
                select: { id: true },
            }),
            this.internal.getUncompletedCount(req.user.userId),
            this.internalCalls.counts(req.user.userId),
            this.unreadFeed.forUser(req.user.userId),
            this.phoneTimeline.getMissedUnreadCountsForAll(),
            (0, company_access_util_js_1.listOwnCompanies)(this.prisma, req.user.userId),
        ]);
        const merged = {};
        for (const source of [g, m, p, w]) {
            for (const [id, n] of Object.entries(source)) {
                merged[Number(id)] = (merged[Number(id)] ?? 0) + n;
            }
        }
        if (workspace) {
            merged[workspace.id] =
                (merged[workspace.id] ?? 0) +
                    internalCount +
                    internalCallCounts.uncompleted;
        }
        const missedCalls = { ...missedPhone };
        if (workspace) {
            missedCalls[workspace.id] =
                (missedCalls[workspace.id] ?? 0) + internalCallCounts.missedUnread;
        }
        const missedCallsOwn = ownCompanies.reduce((n, c) => n + (missedCalls[c.id] ?? 0), 0);
        return {
            uncompleted: merged,
            missedCalls,
            missedCallsOwn,
            unread: feed.items,
            truncated: feed.truncated,
            failed: feed.failed,
        };
    }
    async completeEmailsUntil(companyId, dto) {
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            throw new common_1.NotFoundException('No mailbox is connected');
        const thread = await provider.getEmailThread(companyId, dto.threadId);
        const ids = (0, complete_until_util_js_1.idsUpTo)(thread.messages.map((m) => ({ id: m.id, at: m.date })), dto.messageId);
        if (!ids)
            throw new common_1.NotFoundException('That message is not in this conversation');
        await this.state.flushCompleted(companyId, ids);
        return { completed: ids.length };
    }
    async completeChatsUntil(companyId, dto) {
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            throw new common_1.NotFoundException('No mailbox is connected');
        const thread = await provider.getChatThread(companyId, dto.spaceId);
        const ids = (0, complete_until_util_js_1.idsUpTo)(thread.messages.map((m) => ({ id: m.id, at: m.createTime })), dto.messageId);
        if (!ids)
            throw new common_1.NotFoundException('That message is not in this conversation');
        await this.state.flushCompleted(companyId, ids);
        return { completed: ids.length };
    }
    async completeSmsUntil(companyId, dto) {
        const thread = await this.phoneTimeline.getSmsThread(companyId, dto.peer);
        const ids = (0, complete_until_util_js_1.idsUpTo)(thread.messages, dto.itemId);
        if (!ids)
            throw new common_1.NotFoundException('That message is not in this conversation');
        await this.state.flushCompleted(companyId, ids);
        await this.phoneTimeline.refreshCompanyCounts(companyId);
        this.phoneTimeline.bust(companyId);
        return { completed: ids.length };
    }
    async completeWhatsAppUntil(companyId, dto) {
        return this.whatsapp.completeUntil(companyId, dto.messageId);
    }
    async completeInternalUntil(dto, req) {
        return this.internal.completeUntil(dto.messageId, req.user.userId);
    }
    async readEmailsUntil(companyId, dto) {
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            throw new common_1.NotFoundException('No mailbox is connected');
        const thread = await provider.getEmailThread(companyId, dto.threadId);
        const ids = (0, complete_until_util_js_1.idsUpTo)(thread.messages.map((m) => ({ id: m.id, at: m.date })), dto.messageId);
        if (!ids)
            throw new common_1.NotFoundException('That message is not in this conversation');
        const results = await (0, pool_util_js_1.pool)(ids, pool_util_js_1.GMAIL_GET_CONCURRENCY, (id) => provider.markAsRead(companyId, id).then(() => true, () => false));
        this.gmail.bustUnread(companyId);
        this.unreadFeed.bust(companyId);
        return { completed: results.filter(Boolean).length };
    }
    async readChatsUntil(companyId, dto) {
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            throw new common_1.NotFoundException('No mailbox is connected');
        const thread = await provider.getChatThread(companyId, dto.spaceId);
        const ids = (0, complete_until_util_js_1.idsUpTo)(thread.messages.map((m) => ({ id: m.id, at: m.createTime })), dto.messageId);
        if (!ids)
            throw new common_1.NotFoundException('That message is not in this conversation');
        await this.state.flushRead(companyId, ids);
        this.unreadFeed.bust(companyId);
        return { completed: ids.length };
    }
    async readSmsUntil(companyId, dto) {
        const thread = await this.phoneTimeline.getSmsThread(companyId, dto.peer);
        const ids = (0, complete_until_util_js_1.idsUpTo)(thread.messages, dto.itemId);
        if (!ids)
            throw new common_1.NotFoundException('That message is not in this conversation');
        await this.state.flushRead(companyId, ids);
        await this.phoneTimeline.refreshCompanyCounts(companyId);
        this.phoneTimeline.bust(companyId);
        this.unreadFeed.bust(companyId);
        return { completed: ids.length };
    }
    async readWhatsAppUntil(companyId, dto) {
        const result = await this.whatsapp.readUntil(companyId, dto.messageId);
        this.unreadFeed.bust(companyId);
        return result;
    }
    async summarizeEmailAttachment(companyId, messageId, attachmentId, filename, size, req) {
        if (!(0, ai_config_js_1.aiAssist)(process.env)) {
            throw new common_1.BadRequestException('AI assistance is switched off.');
        }
        await (0, company_access_util_js_1.assertOwnCompany)(this.prisma, companyId, req.user.userId);
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            throw new common_1.NotFoundException('No mailbox is connected');
        const parsedSize = Number.parseInt(size ?? '', 10);
        const bytes = await provider.getEmailAttachment(companyId, messageId, attachmentId, filename && Number.isFinite(parsedSize)
            ? { filename, size: parsedSize }
            : undefined);
        return this.aiDocuments.summarize({
            bytes,
            mimeType: (0, document_kind_util_js_1.mimeForFilename)(filename ?? ''),
            filename: filename ?? 'attachment',
        });
    }
    async readInternalUntil(dto, req) {
        return this.internal.readUntil(dto.messageId, req.user.userId);
    }
};
exports.CommunicationsController = CommunicationsController;
__decorate([
    (0, common_1.Get)('companies/:companyId/account'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "account", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/latest-preview'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "latestPreview", null);
__decorate([
    (0, common_1.Get)('inbox-summary'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "inboxSummary", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/complete-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilEmailDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "completeEmailsUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/complete-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilChatDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "completeChatsUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/sms/complete-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilSmsDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "completeSmsUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/whatsapp/complete-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilIdDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "completeWhatsAppUntil", null);
__decorate([
    (0, common_1.Patch)('internal-messages/complete-until'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [complete_until_dto_js_1.CompleteUntilIdDto, Object]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "completeInternalUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/read-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilEmailDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "readEmailsUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/read-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilChatDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "readChatsUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/sms/read-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilSmsDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "readSmsUntil", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/whatsapp/read-until'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, complete_until_dto_js_1.CompleteUntilIdDto]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "readWhatsAppUntil", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/emails/:messageId/attachments/:attachmentId/summarize'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, common_1.Param)('attachmentId')),
    __param(3, (0, common_1.Query)('filename')),
    __param(4, (0, common_1.Query)('size')),
    __param(5, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "summarizeEmailAttachment", null);
__decorate([
    (0, common_1.Patch)('internal-messages/read-until'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [complete_until_dto_js_1.CompleteUntilIdDto, Object]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "readInternalUntil", null);
exports.CommunicationsController = CommunicationsController = __decorate([
    (0, common_1.Controller)('communications'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [gmail_service_js_1.GmailService,
        microsoft_service_js_1.MicrosoftService,
        provider_resolver_service_js_1.ProviderResolverService,
        internal_messages_service_js_1.InternalMessagesService,
        internal_calls_service_js_1.InternalCallsService,
        phone_timeline_service_js_1.PhoneTimelineService,
        unread_feed_service_js_1.UnreadFeedService,
        prisma_service_js_1.PrismaService,
        whatsapp_messages_service_js_1.WhatsAppMessagesService,
        message_state_service_js_1.MessageStateService,
        ai_document_service_js_1.AiDocumentService])
], CommunicationsController);
//# sourceMappingURL=communications.controller.js.map