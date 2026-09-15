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
exports.WhatsAppController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const client_1 = require("@prisma/client");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const phone_audio_storage_js_1 = require("../phone-audio/phone-audio.storage.js");
const whatsapp_account_service_js_1 = require("./whatsapp-account.service.js");
const whatsapp_provisioning_service_js_1 = require("./whatsapp-provisioning.service.js");
const whatsapp_messages_service_js_1 = require("./whatsapp-messages.service.js");
const whatsapp_dto_js_1 = require("./dto/whatsapp.dto.js");
const STATE_ACTIONS = new Set([
    'read',
    'unread',
    'complete',
    'uncomplete',
]);
let WhatsAppController = class WhatsAppController {
    accounts;
    messages;
    provisioning;
    constructor(accounts, messages, provisioning) {
        this.accounts = accounts;
        this.messages = messages;
        this.provisioning = provisioning;
    }
    config() {
        return this.accounts.clientConfig();
    }
    async account(companyId) {
        return { account: await this.accounts.getAccount(companyId) };
    }
    connect(companyId, dto, req) {
        return this.accounts.connect(companyId, dto, req.user.userId);
    }
    generate(companyId, req) {
        return this.provisioning.generate(companyId, req.user.userId);
    }
    connectFirmNumber(companyId, req) {
        return this.accounts.connectFirmNumber(companyId, req.user.userId);
    }
    async disconnect(companyId) {
        await this.accounts.disconnect(companyId);
    }
    timeline(companyId, cursor, limit) {
        const parsedCursor = Number.parseInt(cursor ?? '', 10);
        const parsedLimit = Number.parseInt(limit ?? '', 10);
        return this.messages.getTimeline(companyId, Number.isInteger(parsedCursor) && parsedCursor > 0
            ? parsedCursor
            : undefined, Number.isFinite(parsedLimit)
            ? Math.min(Math.max(parsedLimit, 1), 100)
            : 25);
    }
    thread(companyId, peer) {
        return this.messages.getThread(companyId, peer ?? '');
    }
    counts(companyId) {
        return this.messages.getCounts(companyId);
    }
    send(companyId, dto, req) {
        return this.messages.sendText(companyId, dto.to, dto.body, req.user.userId);
    }
    sendVoice(companyId, file, to, req) {
        if (!file)
            throw new common_1.BadRequestException('No recording was uploaded');
        return this.messages.sendVoice(companyId, to ?? '', file, req.user.userId);
    }
    async setState(companyId, messageId, action) {
        if (!STATE_ACTIONS.has(action)) {
            throw new common_1.BadRequestException('Unknown action');
        }
        await this.messages.setState(companyId, messageId, action);
    }
};
exports.WhatsAppController = WhatsAppController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "config", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/account'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], WhatsAppController.prototype, "account", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/connect'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, whatsapp_dto_js_1.ConnectWhatsAppDto, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "connect", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/generate'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "generate", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/connect-firm-number'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "connectFirmNumber", null);
__decorate([
    (0, common_1.Delete)('companies/:companyId/account'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], WhatsAppController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/timeline'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('cursor')),
    __param(2, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "timeline", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/thread'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('peer')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "thread", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/counts'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "counts", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/messages'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, whatsapp_dto_js_1.SendWhatsAppDto, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "send", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/messages/voice'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        limits: { fileSize: whatsapp_messages_service_js_1.MAX_VOICE_BYTES, files: 1 },
        fileFilter: phone_audio_storage_js_1.audioFileFilter,
    })),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.UploadedFile)()),
    __param(2, (0, common_1.Body)('to')),
    __param(3, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object, Object, Object]),
    __metadata("design:returntype", void 0)
], WhatsAppController.prototype, "sendVoice", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/items/:messageId/:action'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId', common_1.ParseIntPipe)),
    __param(2, (0, common_1.Param)('action')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Number, String]),
    __metadata("design:returntype", Promise)
], WhatsAppController.prototype, "setState", null);
exports.WhatsAppController = WhatsAppController = __decorate([
    (0, common_1.Controller)('whatsapp'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [whatsapp_account_service_js_1.WhatsAppAccountService,
        whatsapp_messages_service_js_1.WhatsAppMessagesService,
        whatsapp_provisioning_service_js_1.WhatsAppProvisioningService])
], WhatsAppController);
//# sourceMappingURL=whatsapp.controller.js.map