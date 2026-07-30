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
exports.InternalMessagesController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const promises_1 = require("fs/promises");
const jwt = __importStar(require("jsonwebtoken"));
const rxjs_1 = require("rxjs");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const send_internal_message_dto_js_1 = require("./dto/send-internal-message.dto.js");
const internal_messages_service_js_1 = require("./internal-messages.service.js");
const uploads_js_1 = require("./uploads.js");
const FOLDERS = ['INBOX', 'UNCOMPLETED', 'UNREAD', 'SENT'];
const SSE_HEARTBEAT_MS = 25_000;
let InternalMessagesController = class InternalMessagesController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(req, folder, cursor, q) {
        const resolved = FOLDERS.includes(folder)
            ? folder
            : 'INBOX';
        const cursorId = cursor ? Number(cursor) : undefined;
        return this.service.list(req.user.userId, resolved, Number.isInteger(cursorId) && cursorId > 0 ? cursorId : undefined, q);
    }
    async uncompletedCount(req) {
        return { count: await this.service.getUncompletedCount(req.user.userId) };
    }
    async unreadCount(req) {
        return { count: await this.service.getUnreadCount(req.user.userId) };
    }
    thread(req, threadId) {
        const id = Number(threadId);
        if (!Number.isInteger(id) || id <= 0) {
            throw new common_1.BadRequestException('threadId is required');
        }
        return this.service.getThread(id, req.user.userId);
    }
    async attachment(id, token, disposition, req, res) {
        const viewerId = verifyQueryTokenUser(token);
        const attachment = await this.service.getAttachment(id, viewerId);
        const buf = await (0, promises_1.readFile)(attachment.absolutePath);
        (0, attachment_stream_util_js_1.streamAttachment)(res, buf, attachment.mimeType, attachment.filename, disposition, req.headers.range);
    }
    send(req, dto, files) {
        const parentId = dto.parentId ? Number(dto.parentId) : undefined;
        return this.service.send(req.user.userId, {
            to: (0, send_internal_message_dto_js_1.parseUserIdList)(dto.to),
            cc: (0, send_internal_message_dto_js_1.parseUserIdList)(dto.cc),
            subject: dto.subject,
            body: dto.body,
            bodyHtml: dto.bodyHtml,
            parentId: Number.isInteger(parentId) && parentId > 0 ? parentId : undefined,
            isForward: dto.isForward === '1' || dto.isForward === 'true',
        }, files ?? []);
    }
    streamEvents(token, req) {
        const userId = verifyQueryTokenUser(token);
        const subject = new rxjs_1.Subject();
        const clientId = `${userId}-${Date.now()}-${Math.random()}`;
        this.service.addSseClient(clientId, userId, subject);
        const closed = new rxjs_1.Subject();
        req.on('close', () => {
            this.service.removeSseClient(clientId);
            closed.next();
            closed.complete();
        });
        const heartbeat = (0, rxjs_1.interval)(SSE_HEARTBEAT_MS).pipe((0, rxjs_1.map)(() => ({ data: JSON.stringify({ type: 'ping' }) })));
        return (0, rxjs_1.merge)(subject.asObservable(), heartbeat).pipe((0, rxjs_1.takeUntil)(closed));
    }
    getOne(id, req) {
        return this.service.getOne(id, req.user.userId);
    }
    markRead(id, req) {
        return this.service.markRead(id, req.user.userId);
    }
    markUnread(id, req) {
        return this.service.markUnread(id, req.user.userId);
    }
    markComplete(id, req) {
        return this.service.markComplete(id, req.user.userId);
    }
    markUncomplete(id, req) {
        return this.service.markUncomplete(id, req.user.userId);
    }
};
exports.InternalMessagesController = InternalMessagesController;
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('folder')),
    __param(2, (0, common_1.Query)('cursor')),
    __param(3, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('uncompleted-count'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalMessagesController.prototype, "uncompletedCount", null);
__decorate([
    (0, common_1.Get)('unread-count'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], InternalMessagesController.prototype, "unreadCount", null);
__decorate([
    (0, common_1.Get)('thread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('threadId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "thread", null);
__decorate([
    (0, common_1.Get)('attachments/:id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Query)('token')),
    __param(2, (0, common_1.Query)('disposition')),
    __param(3, (0, common_1.Req)()),
    __param(4, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, String, String, Object, Object]),
    __metadata("design:returntype", Promise)
], InternalMessagesController.prototype, "attachment", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('attachments', uploads_js_1.MAX_ATTACHMENTS, {
        storage: uploads_js_1.messageAttachmentStorage,
        limits: { fileSize: uploads_js_1.MAX_ATTACHMENT_BYTES },
    })),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, send_internal_message_dto_js_1.SendInternalMessageDto, Object]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "send", null);
__decorate([
    (0, common_1.Sse)('events'),
    __param(0, (0, common_1.Query)('token')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", rxjs_1.Observable)
], InternalMessagesController.prototype, "streamEvents", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "getOne", null);
__decorate([
    (0, common_1.Patch)(':id/read'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "markRead", null);
__decorate([
    (0, common_1.Patch)(':id/unread'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "markUnread", null);
__decorate([
    (0, common_1.Patch)(':id/complete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "markComplete", null);
__decorate([
    (0, common_1.Patch)(':id/uncomplete'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    (0, common_1.HttpCode)(204),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], InternalMessagesController.prototype, "markUncomplete", null);
exports.InternalMessagesController = InternalMessagesController = __decorate([
    (0, common_1.Controller)('internal-messages'),
    __metadata("design:paramtypes", [internal_messages_service_js_1.InternalMessagesService])
], InternalMessagesController);
function verifyQueryTokenUser(token) {
    try {
        const payload = jwt.verify(token ?? '', process.env.JWT_SECRET ?? 'secret');
        const userId = Number(payload.sub);
        if (!Number.isInteger(userId) || userId <= 0) {
            throw new Error('bad subject');
        }
        return userId;
    }
    catch {
        throw new common_1.UnauthorizedException();
    }
}
//# sourceMappingURL=internal-messages.controller.js.map