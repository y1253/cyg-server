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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const client_1 = require("@prisma/client");
const multer_1 = require("multer");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
const roles_decorator_js_1 = require("../auth/roles.decorator.js");
const roles_guard_js_1 = require("../auth/roles.guard.js");
const create_user_dto_js_1 = require("./dto/create-user.dto.js");
const update_user_dto_js_1 = require("./dto/update-user.dto.js");
const users_service_js_1 = require("./users.service.js");
let UsersController = class UsersController {
    usersService;
    constructor(usersService) {
        this.usersService = usersService;
    }
    getRoles() {
        return this.usersService.getRoles();
    }
    directory(req) {
        return this.usersService.findDirectory(req.user.userId);
    }
    findAll() {
        return this.usersService.findAll();
    }
    findOne(id) {
        return this.usersService.findOne(id);
    }
    create(dto) {
        return this.usersService.create(dto);
    }
    update(id, dto) {
        return this.usersService.update(id, dto);
    }
    remove(id) {
        return this.usersService.remove(id);
    }
    enrollFace(id, files) {
        if (!files || files.length !== 3)
            throw new common_1.BadRequestException('Exactly 3 photos required');
        return this.usersService.enrollFace(id, files.map((f) => ({ buffer: f.buffer, mimeType: f.mimetype })));
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)('roles'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "getRoles", null);
__decorate([
    (0, common_1.Get)('directory'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "directory", null);
__decorate([
    (0, common_1.Get)(),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "findAll", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "findOne", null);
__decorate([
    (0, common_1.Post)(),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_user_dto_js_1.CreateUserDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, update_user_dto_js_1.UpdateUserDto]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "update", null);
__decorate([
    (0, common_1.Delete)(':id'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)(':id/enroll-face'),
    (0, common_1.UseGuards)(roles_guard_js_1.RolesGuard),
    (0, roles_decorator_js_1.Roles)(client_1.Role.ADMIN),
    (0, common_1.UseInterceptors)((0, platform_express_1.FilesInterceptor)('photos', 3, { storage: (0, multer_1.memoryStorage)() })),
    __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
    __param(1, (0, common_1.UploadedFiles)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number, Array]),
    __metadata("design:returntype", void 0)
], UsersController.prototype, "enrollFace", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('users'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [users_service_js_1.UsersService])
], UsersController);
//# sourceMappingURL=users.controller.js.map