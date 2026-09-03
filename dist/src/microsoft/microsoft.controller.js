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
var MicrosoftController_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.MicrosoftController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const microsoft_service_js_1 = require("./microsoft.service.js");
const send_email_dto_js_1 = require("../gmail/dto/send-email.dto.js");
const send_chat_message_dto_js_1 = require("../gmail/dto/send-chat-message.dto.js");
const email_search_js_1 = require("../communications/email-search.js");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const outbound_uploads_js_1 = require("../communications/outbound-uploads.js");
let MicrosoftController = MicrosoftController_1 = class MicrosoftController {
    microsoft;
    logger = new common_1.Logger(MicrosoftController_1.name);
    constructor(microsoft) {
        this.microsoft = microsoft;
    }
    getAuthUrl(companyId, req, kind) {
        return this.microsoft.generateAuthUrl(companyId, req.user.userId, kind === 'personal' ? 'personal' : 'work');
    }
    async callback(code, state, res) {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
        try {
            await this.microsoft.handleCallback(code, state);
            res.redirect(`${frontendUrl}/microsoft/success`);
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : 'Unknown error';
            res.redirect(`${frontendUrl}/microsoft/error?reason=${encodeURIComponent(reason)}`);
        }
    }
    getAccount(companyId) {
        return this.microsoft.getAccount(companyId);
    }
    getContacts(companyId) {
        return this.microsoft.getContacts(companyId);
    }
    getChats(companyId) {
        return this.microsoft.getChats(companyId);
    }
    getChatThread(companyId, spaceId, pageToken) {
        return this.microsoft.getChatThread(companyId, spaceId, pageToken);
    }
    markChatRead(companyId, body) {
        return this.microsoft.markChatRead(companyId, body.messageId);
    }
    markChatUnread(companyId, body) {
        return this.microsoft.markChatUnread(companyId, body.messageId);
    }
    markChatComplete(companyId, body) {
        return this.microsoft.markComplete(companyId, body.messageId);
    }
    markChatUncomplete(companyId, body) {
        return this.microsoft.markUncomplete(companyId, body.messageId);
    }
    getUnreadCount(companyId) {
        return this.microsoft.getUnreadCount(companyId);
    }
    getUncompletedCount(companyId) {
        return this.microsoft.getUncompletedCount(companyId);
    }
    getUncompletedCounts() {
        return this.microsoft.getUncompletedCounts();
    }
    getEmails(companyId, pageToken, labelIds, q, all) {
        const filters = (0, email_search_js_1.parseEmailSearchFilters)(all ?? {});
        const search = (0, email_search_js_1.buildGraphSearch)(q, filters);
        const labels = (0, email_search_js_1.resolveScopeLabels)(labelIds ? labelIds.split(',') : undefined, filters?.scope);
        return this.microsoft.getEmails(companyId, pageToken, labels, search);
    }
    getEmailThread(companyId, threadId) {
        return this.microsoft.getEmailThread(companyId, threadId);
    }
    getEmail(companyId, messageId, immutable) {
        return this.microsoft.getEmail(companyId, messageId, immutable === '1');
    }
    async getEmailAttachment(companyId, messageId, attachmentId, token, mimeType, filename, disposition, transcode, range, res) {
        (0, attachment_stream_util_js_1.verifyQueryToken)(token);
        const buf = await this.microsoft.getEmailAttachment(companyId, messageId, attachmentId);
        const out = await this.maybeTranscode(buf, mimeType, filename, transcode);
        (0, attachment_stream_util_js_1.streamAttachment)(res, out.buf, out.mimeType, out.filename, disposition, range);
    }
    async getChatAttachment(companyId, token, resourceName, mimeType, filename, disposition, transcode, range, res) {
        (0, attachment_stream_util_js_1.verifyQueryToken)(token);
        const buf = await this.microsoft.getChatAttachment(companyId, resourceName);
        const out = await this.maybeTranscode(buf, mimeType, filename, transcode);
        (0, attachment_stream_util_js_1.streamAttachment)(res, out.buf, out.mimeType, out.filename, disposition, range);
    }
    async maybeTranscode(buf, mimeType, filename, transcode) {
        if (transcode !== 'mp3')
            return { buf, mimeType, filename };
        try {
            const mp3 = await (0, attachment_stream_util_js_1.transcodeAudioToMp3)(buf);
            const base = (filename || 'audio').replace(/\.[^.]+$/, '');
            return { buf: mp3, mimeType: 'audio/mpeg', filename: `${base}.mp3` };
        }
        catch (err) {
            this.logger.warn(`ffmpeg transcode failed for "${filename}" (${mimeType}); serving original bytes: ${err instanceof Error ? err.message : String(err)}`);
            return { buf, mimeType, filename };
        }
    }
    markAsRead(companyId, messageId) {
        return this.microsoft.markAsRead(companyId, messageId);
    }
    markAsUnread(companyId, messageId) {
        return this.microsoft.markAsUnread(companyId, messageId);
    }
    markEmailComplete(companyId, messageId) {
        return this.microsoft.markComplete(companyId, messageId);
    }
    markEmailUncomplete(companyId, messageId) {
        return this.microsoft.markUncomplete(companyId, messageId);
    }
    sendEmail(companyId, dto, attachments = []) {
        return this.microsoft.sendEmail(companyId, dto, attachments);
    }
    sendChatMessage(companyId, dto) {
        return this.microsoft.sendChatMessage(companyId, dto);
    }
    disconnect(companyId) {
        return this.microsoft.disconnect(companyId);
    }
};
exports.MicrosoftController = MicrosoftController;
__decorate([
    (0, common_1.Get)('auth-url'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Query)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Query)('kind')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getAuthUrl", null);
__decorate([
    (0, common_1.Get)('callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], MicrosoftController.prototype, "callback", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/account'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getAccount", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/contacts'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getContacts", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/chats'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getChats", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/chat-thread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('spaceId')),
    __param(2, (0, common_1.Query)('pageToken')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getChatThread", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/read'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markChatRead", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/unread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markChatUnread", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/complete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markChatComplete", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/uncomplete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markChatUncomplete", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/unread-count'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getUnreadCount", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/uncompleted-count'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getUncompletedCount", null);
__decorate([
    (0, common_1.Get)('uncompleted-counts'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getUncompletedCounts", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/emails'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('pageToken')),
    __param(2, (0, common_1.Query)('labelIds')),
    __param(3, (0, common_1.Query)('q')),
    __param(4, (0, common_1.Query)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, String, Object]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getEmails", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/email-thread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('threadId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getEmailThread", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/emails/:messageId'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, common_1.Query)('immutable')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "getEmail", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/emails/:messageId/attachments/:attachmentId'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __param(2, (0, common_1.Param)('attachmentId')),
    __param(3, (0, common_1.Query)('token')),
    __param(4, (0, common_1.Query)('mimeType')),
    __param(5, (0, common_1.Query)('filename')),
    __param(6, (0, common_1.Query)('disposition')),
    __param(7, (0, common_1.Query)('transcode')),
    __param(8, (0, common_1.Headers)('range')),
    __param(9, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, String, String, String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], MicrosoftController.prototype, "getEmailAttachment", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/chat-attachment'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Query)('resourceName')),
    __param(3, (0, common_1.Query)('mimeType')),
    __param(4, (0, common_1.Query)('filename')),
    __param(5, (0, common_1.Query)('disposition')),
    __param(6, (0, common_1.Query)('transcode')),
    __param(7, (0, common_1.Headers)('range')),
    __param(8, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, String, String, String, String, String, Object]),
    __metadata("design:returntype", Promise)
], MicrosoftController.prototype, "getChatAttachment", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/:messageId/read'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markAsRead", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/:messageId/unread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markAsUnread", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/:messageId/complete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markEmailComplete", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/:messageId/uncomplete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "markEmailUncomplete", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/send'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('attachments', undefined, {
        storage: outbound_uploads_js_1.outboundAttachmentStorage,
        limits: outbound_uploads_js_1.OUTBOUND_MULTER_LIMITS,
    })),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, send_email_dto_js_1.SendEmailDto, Array]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "sendEmail", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/chat-messages'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, send_chat_message_dto_js_1.SendChatMessageDto]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "sendChatMessage", null);
__decorate([
    (0, common_1.Delete)('companies/:companyId/disconnect'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], MicrosoftController.prototype, "disconnect", null);
exports.MicrosoftController = MicrosoftController = MicrosoftController_1 = __decorate([
    (0, common_1.Controller)('microsoft'),
    __metadata("design:paramtypes", [microsoft_service_js_1.MicrosoftService])
], MicrosoftController);
//# sourceMappingURL=microsoft.controller.js.map