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
exports.PhoneController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const phone_provisioning_service_js_1 = require("./phone-provisioning.service.js");
const attach_number_dto_js_1 = require("./dto/attach-number.dto.js");
const phone_events_service_js_1 = require("./phone-events.service.js");
const phone_config_js_1 = require("./phone.config.js");
const attachment_stream_util_js_1 = require("../communications/attachment-stream.util.js");
const rxjs_1 = require("rxjs");
const SSE_HEARTBEAT_MS = 25_000;
let PhoneController = class PhoneController {
    provisioning;
    events;
    constructor(provisioning, events) {
        this.provisioning = provisioning;
        this.events = events;
    }
    getSipCredentials() {
        const creds = (0, phone_config_js_1.sipCredentials)(process.env);
        if (!creds) {
            throw new common_1.ServiceUnavailableException('Softphone is not configured on the server');
        }
        return creds;
    }
    streamEvents(token, req) {
        const userId = (0, attachment_stream_util_js_1.verifyQueryTokenUser)(token);
        const subject = new rxjs_1.Subject();
        const clientId = `${userId}-${Date.now()}-${Math.random()}`;
        this.events.addClient(clientId, userId, subject);
        const closed = new rxjs_1.Subject();
        req.on('close', () => {
            this.events.removeClient(clientId);
            closed.next();
            closed.complete();
        });
        const heartbeat = (0, rxjs_1.interval)(SSE_HEARTBEAT_MS).pipe((0, rxjs_1.map)(() => ({ data: JSON.stringify({ type: 'ping' }) })));
        return (0, rxjs_1.merge)(subject.asObservable(), heartbeat).pipe((0, rxjs_1.takeUntil)(closed));
    }
    searchAvailable(country, areaCode) {
        return this.provisioning.searchAvailable(country, areaCode);
    }
    getNumber(companyId) {
        return this.provisioning.getActiveNumber(companyId);
    }
    attachNumber(companyId, dto) {
        return this.provisioning.attachNumber(companyId, dto.phoneNumber, dto.region);
    }
    releaseNumber(companyId) {
        return this.provisioning.releaseNumber(companyId);
    }
};
exports.PhoneController = PhoneController;
__decorate([
    (0, common_1.Get)('sip-credentials'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getSipCredentials", null);
__decorate([
    (0, common_1.Sse)('events'),
    __param(0, (0, common_1.Query)('token')),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", rxjs_1.Observable)
], PhoneController.prototype, "streamEvents", null);
__decorate([
    (0, common_1.Get)('available'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Query)('country')),
    __param(1, (0, common_1.Query)('areaCode')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "searchAvailable", null);
__decorate([
    (0, common_1.Get)('companies/:companyId/number'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "getNumber", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/number'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, attach_number_dto_js_1.AttachNumberDto]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "attachNumber", null);
__decorate([
    (0, common_1.Delete)('companies/:companyId/number'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneController.prototype, "releaseNumber", null);
exports.PhoneController = PhoneController = __decorate([
    (0, common_1.Controller)('phone'),
    __metadata("design:paramtypes", [phone_provisioning_service_js_1.PhoneProvisioningService,
        phone_events_service_js_1.PhoneEventsService])
], PhoneController);
//# sourceMappingURL=phone.controller.js.map