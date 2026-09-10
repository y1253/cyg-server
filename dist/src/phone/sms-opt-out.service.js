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
var SmsOptOutService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SmsOptOutService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
let SmsOptOutService = SmsOptOutService_1 = class SmsOptOutService {
    prisma;
    logger = new common_1.Logger(SmsOptOutService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async optOut(phoneNumber, keyword) {
        await this.prisma.smsOptOut.upsert({
            where: { phoneNumber },
            update: {},
            create: { phoneNumber, keyword },
        });
        this.logger.log(`opt-out ${phoneNumber} keyword=${keyword}`);
    }
    async optIn(phoneNumber) {
        const { count } = await this.prisma.smsOptOut.deleteMany({
            where: { phoneNumber },
        });
        if (count > 0)
            this.logger.log(`opt-in ${phoneNumber}`);
    }
    async isOptedOut(phoneNumber) {
        const row = await this.prisma.smsOptOut.findUnique({
            where: { phoneNumber },
            select: { id: true },
        });
        return row !== null;
    }
};
exports.SmsOptOutService = SmsOptOutService;
exports.SmsOptOutService = SmsOptOutService = SmsOptOutService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], SmsOptOutService);
//# sourceMappingURL=sms-opt-out.service.js.map