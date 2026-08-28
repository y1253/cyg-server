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
var CallRoutingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallRoutingService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
let CallRoutingService = CallRoutingService_1 = class CallRoutingService {
    prisma;
    logger = new common_1.Logger(CallRoutingService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async resolve(to) {
        const number = await this.findActiveNumber(to);
        if (!number) {
            this.logger.warn(`inbound call to ${to} matches no active SupportNumber`);
            return null;
        }
        const company = await this.prisma.company.findFirst({
            where: { id: number.companyId, deletedAt: null },
            select: {
                id: true,
                businessName: true,
                assignments: { select: { userId: true } },
            },
        });
        if (!company) {
            this.logger.warn(`SupportNumber ${to} points at company ${number.companyId}, which is missing or deleted`);
            return null;
        }
        const assigned = company.assignments.map((a) => a.userId);
        if (assigned.length > 0) {
            return {
                companyId: company.id,
                companyName: company.businessName,
                targetUserIds: assigned,
                viaAdminFallback: false,
            };
        }
        const admins = await this.prisma.user.findMany({
            where: { role: client_1.Role.ADMIN, deletedAt: null },
            select: { id: true },
        });
        this.logger.log(`${company.businessName} has no assigned user — falling back to ${admins.length} admin(s)`);
        return {
            companyId: company.id,
            companyName: company.businessName,
            targetUserIds: admins.map((a) => a.id),
            viaAdminFallback: true,
        };
    }
    findActiveNumber(phoneNumber) {
        return this.prisma.supportNumber.findFirst({
            where: { phoneNumber, releasedAt: null },
            orderBy: { id: 'desc' },
            select: { companyId: true },
        });
    }
};
exports.CallRoutingService = CallRoutingService;
exports.CallRoutingService = CallRoutingService = CallRoutingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], CallRoutingService);
//# sourceMappingURL=call-routing.service.js.map