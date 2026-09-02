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
exports.PhoneSettingsController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const phone_settings_service_js_1 = require("./phone-settings.service.js");
const phone_message_util_js_1 = require("./phone-message.util.js");
const update_phone_defaults_dto_js_1 = require("./dto/update-phone-defaults.dto.js");
const update_company_phone_settings_dto_js_1 = require("./dto/update-company-phone-settings.dto.js");
const preview_message_dto_js_1 = require("./dto/preview-message.dto.js");
let PhoneSettingsController = class PhoneSettingsController {
    settings;
    constructor(settings) {
        this.settings = settings;
    }
    async getDefaults() {
        const defaults = await this.settings.getDefaults();
        return { defaults, placeholders: phone_message_util_js_1.PLACEHOLDERS };
    }
    async updateDefaults(dto) {
        const defaults = await this.settings.updateDefaults(dto);
        return { defaults, placeholders: phone_message_util_js_1.PLACEHOLDERS };
    }
    getForCompany(companyId) {
        return this.settings.getForCompany(companyId);
    }
    updateForCompany(companyId, dto) {
        return this.settings.updateForCompany(companyId, dto);
    }
    resetForCompany(companyId) {
        return this.settings.resetForCompany(companyId);
    }
    preview(dto) {
        return this.settings.preview(dto.template, dto.companyId, dto.at);
    }
};
exports.PhoneSettingsController = PhoneSettingsController;
__decorate([
    (0, common_1.Get)('defaults'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], PhoneSettingsController.prototype, "getDefaults", null);
__decorate([
    (0, common_1.Patch)('defaults'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_phone_defaults_dto_js_1.UpdatePhoneDefaultsDto]),
    __metadata("design:returntype", Promise)
], PhoneSettingsController.prototype, "updateDefaults", null);
__decorate([
    (0, common_1.Get)('companies/:companyId'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneSettingsController.prototype, "getForCompany", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, update_company_phone_settings_dto_js_1.UpdateCompanyPhoneSettingsDto]),
    __metadata("design:returntype", void 0)
], PhoneSettingsController.prototype, "updateForCompany", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/reset'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], PhoneSettingsController.prototype, "resetForCompany", null);
__decorate([
    (0, common_1.Post)('preview'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [preview_message_dto_js_1.PreviewMessageDto]),
    __metadata("design:returntype", void 0)
], PhoneSettingsController.prototype, "preview", null);
exports.PhoneSettingsController = PhoneSettingsController = __decorate([
    (0, common_1.Controller)('phone-settings'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __metadata("design:paramtypes", [phone_settings_service_js_1.PhoneSettingsService])
], PhoneSettingsController);
//# sourceMappingURL=phone-settings.controller.js.map