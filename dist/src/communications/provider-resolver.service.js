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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProviderResolverService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const gmail_service_js_1 = require("../gmail/gmail.service.js");
const microsoft_service_js_1 = require("../microsoft/microsoft.service.js");
let ProviderResolverService = class ProviderResolverService {
    prisma;
    gmail;
    microsoft;
    constructor(prisma, gmail, microsoft) {
        this.prisma = prisma;
        this.gmail = gmail;
        this.microsoft = microsoft;
    }
    async getConnectedProvider(companyId) {
        const [g, m] = await Promise.all([
            this.prisma.gmailAccount.findUnique({
                where: { companyId },
                select: { id: true },
            }),
            this.prisma.microsoftAccount.findUnique({
                where: { companyId },
                select: { id: true },
            }),
        ]);
        if (g)
            return 'GOOGLE';
        if (m)
            return 'MICROSOFT';
        return null;
    }
    async resolve(companyId) {
        const kind = await this.getConnectedProvider(companyId);
        if (kind === 'GOOGLE')
            return this.gmail;
        if (kind === 'MICROSOFT')
            return this.microsoft;
        return null;
    }
};
exports.ProviderResolverService = ProviderResolverService;
exports.ProviderResolverService = ProviderResolverService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        gmail_service_js_1.GmailService,
        microsoft_service_js_1.MicrosoftService])
], ProviderResolverService);
//# sourceMappingURL=provider-resolver.service.js.map