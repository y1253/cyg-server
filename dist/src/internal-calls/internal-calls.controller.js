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
exports.InternalCallsController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const internal_calls_service_js_1 = require("./internal-calls.service.js");
const start_internal_call_dto_js_1 = require("./dto/start-internal-call.dto.js");
const transfer_call_dto_js_1 = require("../phone/dto/transfer-call.dto.js");
const conference_dto_js_1 = require("../phone/dto/conference.dto.js");
let InternalCallsController = class InternalCallsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(req, folder, cursor, limit) {
        const parsedLimit = Number(limit);
        const parsedCursor = Number(cursor);
        return this.service.list(req.user.userId, internal_calls_service_js_1.INTERNAL_CALL_FOLDERS.includes(folder)
            ? folder
            : 'INBOX', Number.isInteger(parsedCursor) && parsedCursor > 0
            ? parsedCursor
            : undefined, Number.isInteger(parsedLimit) && parsedLimit > 0
            ? parsedLimit
            : undefined);
    }
    counts(req) {
        return this.service.counts(req.user.userId);
    }
    start(req, dto) {
        return this.service.startCall(req.user.userId, dto.calleeId);
    }
    transferBlind(sid, dto, req) {
        return this.service.transferBlind(req.user.userId, sid, dto.targetUserId);
    }
    transferStatus(req, sid) {
        return this.service.transferStatus(req.user.userId, sid);
    }
    conferenceAdd(sid, dto, req) {
        return this.service.conferenceAdd(req.user.userId, sid, dto.targetUserId);
    }
    conferenceHold(sid, dto, req) {
        return this.service.conferenceHold(req.user.userId, sid, dto.partyId, dto.held);
    }
    conferenceSwap(sid, req) {
        return this.service.conferenceSwap(req.user.userId, sid);
    }
    conferenceMerge(sid, req) {
        return this.service.conferenceMerge(req.user.userId, sid);
    }
    conferenceDrop(sid, dto, req) {
        return this.service.conferenceDrop(req.user.userId, sid, dto.partyId);
    }
    conferenceStatus(sid, req) {
        return this.service.conferenceStatus(req.user.userId, sid);
    }
    recordings(req, sid) {
        return this.service.recordings(req.user.userId, sid);
    }
    markRead(req, sid) {
        return this.service.setState(req.user.userId, sid, 'read');
    }
    markUnread(req, sid) {
        return this.service.setState(req.user.userId, sid, 'unread');
    }
    markComplete(req, sid) {
        return this.service.setState(req.user.userId, sid, 'complete');
    }
    markUncomplete(req, sid) {
        return this.service.setState(req.user.userId, sid, 'uncomplete');
    }
};
exports.InternalCallsController = InternalCallsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('folder')),
    __param(2, (0, common_1.Query)('cursor')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('counts'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "counts", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, start_internal_call_dto_js_1.StartInternalCallDto]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "start", null);
__decorate([
    (0, common_1.Post)(':sid/transfer/blind'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, transfer_call_dto_js_1.TransferCallDto, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "transferBlind", null);
__decorate([
    (0, common_1.Get)(':sid/transfer-status'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "transferStatus", null);
__decorate([
    (0, common_1.Post)(':sid/conference/add'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, transfer_call_dto_js_1.TransferCallDto, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "conferenceAdd", null);
__decorate([
    (0, common_1.Post)(':sid/conference/hold'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, conference_dto_js_1.PartyHoldDto, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "conferenceHold", null);
__decorate([
    (0, common_1.Post)(':sid/conference/swap'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "conferenceSwap", null);
__decorate([
    (0, common_1.Post)(':sid/conference/merge'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "conferenceMerge", null);
__decorate([
    (0, common_1.Post)(':sid/conference/drop'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, conference_dto_js_1.PartyDto, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "conferenceDrop", null);
__decorate([
    (0, common_1.Get)(':sid/conference-status'),
    __param(0, (0, common_1.Param)('sid')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "conferenceStatus", null);
__decorate([
    (0, common_1.Get)(':sid/recordings'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "recordings", null);
__decorate([
    (0, common_1.Patch)(':sid/read'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "markRead", null);
__decorate([
    (0, common_1.Patch)(':sid/unread'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "markUnread", null);
__decorate([
    (0, common_1.Patch)(':sid/complete'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "markComplete", null);
__decorate([
    (0, common_1.Patch)(':sid/uncomplete'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "markUncomplete", null);
exports.InternalCallsController = InternalCallsController = __decorate([
    (0, common_1.Controller)('internal-calls'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [internal_calls_service_js_1.InternalCallsService])
], InternalCallsController);
//# sourceMappingURL=internal-calls.controller.js.map