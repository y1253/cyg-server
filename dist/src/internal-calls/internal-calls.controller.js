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
let InternalCallsController = class InternalCallsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(req, limit) {
        const parsed = Number(limit);
        return this.service.list(req.user.userId, Number.isInteger(parsed) && parsed > 0 ? parsed : undefined);
    }
    start(req, dto) {
        return this.service.startCall(req.user.userId, dto.calleeId);
    }
    recordings(req, sid) {
        return this.service.recordings(req.user.userId, sid);
    }
};
exports.InternalCallsController = InternalCallsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "list", null);
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
    (0, common_1.Get)(':sid/recordings'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('sid')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InternalCallsController.prototype, "recordings", null);
exports.InternalCallsController = InternalCallsController = __decorate([
    (0, common_1.Controller)('internal-calls'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [internal_calls_service_js_1.InternalCallsService])
], InternalCallsController);
//# sourceMappingURL=internal-calls.controller.js.map