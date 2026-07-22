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
exports.CommunicationsController = void 0;
const common_1 = require("@nestjs/common");
const gmail_service_js_1 = require("../gmail/gmail.service.js");
const microsoft_service_js_1 = require("../microsoft/microsoft.service.js");
const provider_resolver_service_js_1 = require("./provider-resolver.service.js");
const jwt_auth_guard_js_1 = require("../auth/jwt-auth.guard.js");
let CommunicationsController = class CommunicationsController {
    gmail;
    microsoft;
    resolver;
    constructor(gmail, microsoft, resolver) {
        this.gmail = gmail;
        this.microsoft = microsoft;
        this.resolver = resolver;
    }
    async account(companyId) {
        const provider = await this.resolver.resolve(companyId);
        if (!provider)
            return null;
        return provider.getAccount(companyId);
    }
    async uncompletedCounts() {
        const [g, m] = await Promise.all([
            this.gmail.getUncompletedCounts(),
            this.microsoft.getUncompletedCounts(),
        ]);
        return { ...g, ...m };
    }
};
exports.CommunicationsController = CommunicationsController;
__decorate([
    (0, common_1.Get)('companies/:companyId/account'),
    __param(0, (0, common_1.Param)('companyId', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "account", null);
__decorate([
    (0, common_1.Get)('uncompleted-counts'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], CommunicationsController.prototype, "uncompletedCounts", null);
exports.CommunicationsController = CommunicationsController = __decorate([
    (0, common_1.Controller)('communications'),
    (0, common_1.UseGuards)(jwt_auth_guard_js_1.JwtAuthGuard),
    __metadata("design:paramtypes", [gmail_service_js_1.GmailService,
        microsoft_service_js_1.MicrosoftService,
        provider_resolver_service_js_1.ProviderResolverService])
], CommunicationsController);
//# sourceMappingURL=communications.controller.js.map