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
let PhoneController = class PhoneController {
    provisioning;
    constructor(provisioning) {
        this.provisioning = provisioning;
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
    __metadata("design:paramtypes", [phone_provisioning_service_js_1.PhoneProvisioningService])
], PhoneController);
//# sourceMappingURL=phone.controller.js.map