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
exports.SignatureImageController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const client_1 = require("@prisma/client");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const signature_image_service_js_1 = require("./signature-image.service.js");
const signature_image_storage_js_1 = require("./signature-image.storage.js");
let SignatureImageController = class SignatureImageController {
    images;
    constructor(images) {
        this.images = images;
    }
    list() {
        return this.images.list();
    }
    upload(file, name, req) {
        if (!file)
            throw new common_1.BadRequestException('No file was uploaded');
        return this.images.create(file, name, req.user.userId);
    }
    rename(id, name) {
        return this.images.rename(id, name ?? '');
    }
    remove(id) {
        return this.images.remove(id);
    }
};
exports.SignatureImageController = SignatureImageController;
__decorate([
    (0, common_1.Get)(),
    (0, roles_decorator_js_1.Roles)(...roles_decorator_js_1.MANAGEMENT_ROLES),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], SignatureImageController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: signature_image_storage_js_1.signatureImageStorage,
        limits: signature_image_storage_js_1.SIGNATURE_IMAGE_MULTER_LIMITS,
        fileFilter: signature_image_storage_js_1.imageFileFilter,
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)('name')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", void 0)
], SignatureImageController.prototype, "upload", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)('name')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Object]),
    __metadata("design:returntype", void 0)
], SignatureImageController.prototype, "rename", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.HttpCode)(common_1.HttpStatus.NO_CONTENT),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], SignatureImageController.prototype, "remove", null);
exports.SignatureImageController = SignatureImageController = __decorate([
    (0, common_1.Controller)('signature-images'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard, roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __metadata("design:paramtypes", [signature_image_service_js_1.SignatureImageService])
], SignatureImageController);
//# sourceMappingURL=signature-image.controller.js.map