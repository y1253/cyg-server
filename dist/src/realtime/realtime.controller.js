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
exports.RealtimeController = void 0;
const common_1 = require("@nestjs/common");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const realtime_service_js_1 = require("./realtime.service.js");
let RealtimeController = class RealtimeController {
    realtime;
    constructor(realtime) {
        this.realtime = realtime;
    }
    events(req, since) {
        const parsed = Number.parseInt(since ?? '0', 10);
        const cursor = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
        return this.realtime.wait(req.user.userId, cursor);
    }
};
exports.RealtimeController = RealtimeController;
__decorate([
    (0, common_1.Get)('events'),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Query)('since')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], RealtimeController.prototype, "events", null);
exports.RealtimeController = RealtimeController = __decorate([
    (0, common_1.Controller)('realtime'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [realtime_service_js_1.RealtimeService])
], RealtimeController);
//# sourceMappingURL=realtime.controller.js.map