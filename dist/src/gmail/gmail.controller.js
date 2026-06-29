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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GmailController = void 0;
const common_1 = require("@nestjs/common");
const rxjs_1 = require("rxjs");
const jwt = __importStar(require("jsonwebtoken"));
const gmail_service_js_1 = require("./gmail.service.js");
const send_email_dto_js_1 = require("./dto/send-email.dto.js");
const send_chat_message_dto_js_1 = require("./dto/send-chat-message.dto.js");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
let GmailController = class GmailController {
    gmailService;
    constructor(gmailService) {
        this.gmailService = gmailService;
    }
    getAuthUrl(companyId, req) {
        return this.gmailService.generateAuthUrl(companyId, req.user.userId);
    }
    async callback(code, state, res) {
        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
        try {
            await this.gmailService.handleCallback(code, state);
            res.redirect(`${frontendUrl}/gmail/success`);
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : 'Unknown error';
            res.redirect(`${frontendUrl}/gmail/error?reason=${encodeURIComponent(reason)}`);
        }
    }
    getAccount(companyId) {
        return this.gmailService.getAccount(companyId);
    }
    getChats(companyId) {
        return this.gmailService.getChats(companyId);
    }
    getChatThread(companyId, spaceId, pageToken) {
        return this.gmailService.getChatThread(companyId, spaceId, pageToken);
    }
    markChatRead(companyId, body) {
        return this.gmailService.markChatRead(companyId, body.spaceId);
    }
    markChatUnread(companyId, body) {
        return this.gmailService.markChatUnread(companyId, body.spaceId);
    }
    getUnreadCount(companyId) {
        return this.gmailService.getUnreadCount(companyId);
    }
    getEmails(companyId, pageToken, labelIds) {
        const labels = labelIds ? labelIds.split(',') : undefined;
        return this.gmailService.getEmails(companyId, pageToken, labels);
    }
    getEmail(companyId, messageId) {
        return this.gmailService.getEmail(companyId, messageId);
    }
    markAsRead(companyId, messageId) {
        return this.gmailService.markAsRead(companyId, messageId);
    }
    markAsUnread(companyId, messageId) {
        return this.gmailService.markAsUnread(companyId, messageId);
    }
    sendEmail(companyId, dto) {
        return this.gmailService.sendEmail(companyId, dto);
    }
    sendChatMessage(companyId, dto) {
        return this.gmailService.sendChatMessage(companyId, dto);
    }
    disconnect(companyId) {
        return this.gmailService.disconnect(companyId);
    }
    handleWebhook(body) {
        void this.gmailService.handleWebhook(body);
    }
    streamEvents(companyId, token, req) {
        try {
            jwt.verify(token, process.env.JWT_SECRET ?? 'secret');
        }
        catch {
            throw new Error('Unauthorized');
        }
        const subject = new rxjs_1.Subject();
        const clientId = `${companyId}-${Date.now()}-${Math.random()}`;
        this.gmailService.addSseClient(clientId, companyId, subject);
        req.on('close', () => {
            this.gmailService.removeSseClient(clientId);
        });
        return subject.asObservable();
    }
};
exports.GmailController = GmailController;
__decorate([
    (0, common_1.Get)('auth-url'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Query)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getAuthUrl", null);
__decorate([
    (0, common_1.Get)('callback'),
    __param(0, (0, common_1.Query)('code')),
    __param(1, (0, common_1.Query)('state')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], GmailController.prototype, "callback", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/account'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getAccount", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/chats'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getChats", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/chat-thread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('spaceId')),
    __param(2, (0, common_1.Query)('pageToken')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getChatThread", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/read'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "markChatRead", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/chats/unread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "markChatUnread", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/unread-count'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getUnreadCount", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/emails'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('pageToken')),
    __param(2, (0, common_1.Query)('labelIds')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getEmails", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/emails/:messageId'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "getEmail", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/:messageId/read'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "markAsRead", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId/emails/:messageId/unread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Param)('messageId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "markAsUnread", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/send'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)('ADMIN'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, send_email_dto_js_1.SendEmailDto]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "sendEmail", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/chat-messages'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, send_chat_message_dto_js_1.SendChatMessageDto]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "sendChatMessage", null);
__decorate([
    (0, common_1.Delete)('companies/:companyId/disconnect'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)('ADMIN'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "disconnect", null);
__decorate([
    (0, common_1.Post)('webhook'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], GmailController.prototype, "handleWebhook", null);
__decorate([
    (0, common_1.Sse)('companies/:companyId/events'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, Object]),
    __metadata("design:returntype", rxjs_1.Observable)
], GmailController.prototype, "streamEvents", null);
exports.GmailController = GmailController = __decorate([
    (0, common_1.Controller)('gmail'),
    __metadata("design:paramtypes", [gmail_service_js_1.GmailService])
], GmailController);
//# sourceMappingURL=gmail.controller.js.map