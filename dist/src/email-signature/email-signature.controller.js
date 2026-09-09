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
exports.EmailSignatureController = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const email_signature_service_js_1 = require("./email-signature.service.js");
const signature_template_util_js_1 = require("./signature-template.util.js");
const update_signature_defaults_dto_js_1 = require("./dto/update-signature-defaults.dto.js");
const update_company_signature_dto_js_1 = require("./dto/update-company-signature.dto.js");
const preview_signature_dto_js_1 = require("./dto/preview-signature.dto.js");
let EmailSignatureController = class EmailSignatureController {
    signatures;
    constructor(signatures) {
        this.signatures = signatures;
    }
    async getDefaults() {
        const defaults = await this.signatures.getDefaults();
        return { defaults, placeholders: signature_template_util_js_1.PLACEHOLDERS };
    }
    async updateDefaults(dto) {
        const defaults = await this.signatures.updateDefaults(dto);
        return { defaults, placeholders: signature_template_util_js_1.PLACEHOLDERS };
    }
    getForCompany(companyId) {
        return this.signatures.getForCompany(companyId);
    }
    updateForCompany(companyId, dto) {
        return this.signatures.updateForCompany(companyId, dto);
    }
    resetForCompany(companyId) {
        return this.signatures.resetForCompany(companyId);
    }
    preview(dto) {
        return this.signatures.preview(dto.template, dto.companyId, dto.signatureImageId);
    }
};
exports.EmailSignatureController = EmailSignatureController;
__decorate([
    (0, common_1.Get)('defaults'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], EmailSignatureController.prototype, "getDefaults", null);
__decorate([
    (0, common_1.Patch)('defaults'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [update_signature_defaults_dto_js_1.UpdateSignatureDefaultsDto]),
    __metadata("design:returntype", Promise)
], EmailSignatureController.prototype, "updateDefaults", null);
__decorate([
    (0, common_1.Get)('companies/:companyId'),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], EmailSignatureController.prototype, "getForCompany", null);
__decorate([
    (0, common_1.Patch)('companies/:companyId'),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, update_company_signature_dto_js_1.UpdateCompanyEmailSignatureDto]),
    __metadata("design:returntype", void 0)
], EmailSignatureController.prototype, "updateForCompany", null);
__decorate([
    (0, common_1.Post)('companies/:companyId/reset'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], EmailSignatureController.prototype, "resetForCompany", null);
__decorate([
    (0, common_1.Post)('preview'),
    (0, common_1.HttpCode)(common_1.HttpStatus.OK),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [preview_signature_dto_js_1.PreviewSignatureDto]),
    __metadata("design:returntype", void 0)
], EmailSignatureController.prototype, "preview", null);
exports.EmailSignatureController = EmailSignatureController = __decorate([
    (0, common_1.Controller)('email-signature'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __metadata("design:paramtypes", [email_signature_service_js_1.EmailSignatureService])
], EmailSignatureController);
//# sourceMappingURL=email-signature.controller.js.map