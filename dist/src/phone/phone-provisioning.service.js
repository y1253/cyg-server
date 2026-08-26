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
var PhoneProvisioningService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneProvisioningService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const signalwire_service_js_1 = require("./signalwire.service.js");
const signalwire_parse_js_1 = require("./signalwire-parse.js");
const phone_config_js_1 = require("./phone.config.js");
let PhoneProvisioningService = PhoneProvisioningService_1 = class PhoneProvisioningService {
    prisma;
    signalwire;
    logger = new common_1.Logger(PhoneProvisioningService_1.name);
    constructor(prisma, signalwire) {
        this.prisma = prisma;
        this.signalwire = signalwire;
    }
    async getActiveNumber(companyId) {
        return this.prisma.supportNumber.findFirst({
            where: { companyId, releasedAt: null },
            orderBy: { id: 'desc' },
        });
    }
    async searchAvailable(country, areaCode) {
        const iso = (0, signalwire_parse_js_1.toIsoCountry)(country);
        if (!iso) {
            throw new common_1.BadRequestException(`Unsupported country "${country}" — expected USA or CANADA`);
        }
        if (areaCode !== undefined &&
            areaCode !== '' &&
            !(0, signalwire_parse_js_1.isValidAreaCode)(areaCode)) {
            throw new common_1.BadRequestException('Area code must be 3 digits and cannot start with 0 or 1');
        }
        return this.searchEligible(iso, areaCode || undefined);
    }
    async searchEligible(iso, areaCode) {
        if (areaCode) {
            return this.eligible(await this.signalwire.searchAvailable(iso, { areaCode }));
        }
        const regions = (0, phone_config_js_1.regionsFor)(iso, process.env);
        const attempts = regions.length > 0 ? regions : [undefined];
        for (const inRegion of attempts) {
            const found = this.eligible(await this.signalwire.searchAvailable(iso, { inRegion }));
            if (found.length > 0)
                return found;
        }
        return [];
    }
    eligible(numbers) {
        return numbers.filter((n) => n.voice && n.sms);
    }
    async attachNumber(companyId, phoneNumber, region) {
        const company = await this.assertProvisionable(companyId);
        if (await this.getActiveNumber(companyId)) {
            throw new common_1.ConflictException('This company already has a support number. Disconnect it first.');
        }
        const purchased = await this.signalwire.purchaseNumber({
            phoneNumber,
            friendlyName: company.businessName,
            ...(0, phone_config_js_1.webhookUrls)(process.env),
        });
        try {
            if (!purchased.voice || !purchased.sms) {
                throw new common_1.BadRequestException(`${purchased.phoneNumber} is not both voice- and SMS-capable`);
            }
            return await this.prisma.$transaction(async (tx) => {
                const existing = await tx.supportNumber.findFirst({
                    where: { companyId, releasedAt: null },
                });
                if (existing) {
                    throw new common_1.ConflictException('This company already has a support number. Disconnect it first.');
                }
                const row = await tx.supportNumber.create({
                    data: {
                        companyId,
                        activeForCompanyId: companyId,
                        sid: purchased.sid,
                        phoneNumber: purchased.phoneNumber,
                        region: region ?? null,
                    },
                });
                try {
                    await tx.company.update({
                        where: { id: companyId },
                        data: { supportNumber: purchased.phoneNumber },
                    });
                }
                catch (err) {
                    if (err instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                        err.code === 'P2002') {
                        this.logger.error(`Company.supportNumber mirror failed for company ${companyId}: ` +
                            `${purchased.phoneNumber} is already typed on another company. ` +
                            `Clear that stale value; the number itself is attached correctly.`);
                    }
                    else {
                        throw err;
                    }
                }
                return row;
            });
        }
        catch (err) {
            this.logger.error(`PHONE ORPHAN companyId=${companyId} sid=${purchased.sid} ` +
                `number=${purchased.phoneNumber} — attach failed, releasing`);
            try {
                await this.signalwire.releaseNumber(purchased.sid);
            }
            catch {
                this.logger.error(`PHONE ORPHAN companyId=${companyId} sid=${purchased.sid} ` +
                    `number=${purchased.phoneNumber} — RELEASE ALSO FAILED, ` +
                    `manual cleanup required in the SignalWire dashboard`);
            }
            throw err;
        }
    }
    async releaseNumber(companyId) {
        const row = await this.getActiveNumber(companyId);
        if (!row) {
            throw new common_1.NotFoundException('This company has no support number');
        }
        await this.signalwire.releaseNumber(row.sid);
        await this.prisma.$transaction([
            this.prisma.supportNumber.update({
                where: { id: row.id },
                data: { releasedAt: new Date(), activeForCompanyId: null },
            }),
            this.prisma.company.update({
                where: { id: companyId },
                data: { supportNumber: null },
            }),
        ]);
    }
    async autoProvisionForCompany(companyId) {
        try {
            const company = await this.prisma.company.findUnique({
                where: { id: companyId },
                select: {
                    id: true,
                    businessName: true,
                    country: true,
                    isInternal: true,
                    deletedAt: true,
                },
            });
            if (!company || company.isInternal || company.deletedAt) {
                return { status: 'skipped', reason: 'not a provisionable company' };
            }
            const iso = (0, signalwire_parse_js_1.toIsoCountry)(company.country);
            if (!iso) {
                this.logger.warn(`Skipping auto-provision for company ${companyId}: unsupported country ` +
                    `"${company.country ?? 'null'}"`);
                return { status: 'skipped', reason: 'unsupported country' };
            }
            if (!(await this.underDailyCap())) {
                this.logger.error(`PHONE CAP REACHED — skipping auto-provision for company ${companyId}. ` +
                    `Raise PHONE_MAX_PURCHASES_PER_DAY if this is legitimate volume.`);
                return { status: 'skipped', reason: 'daily purchase cap reached' };
            }
            if (await this.getActiveNumber(companyId)) {
                return { status: 'skipped', reason: 'already has a number' };
            }
            const candidates = await this.searchEligible(iso);
            if (candidates.length === 0) {
                this.logger.warn(`No voice+SMS-capable ${iso} numbers available for company ${companyId}. ` +
                    (iso === 'US'
                        ? 'Expected until A2P 10DLC registration completes — US long codes are voice-only until then.'
                        : 'Check inventory in PHONE_DEFAULT_REGIONS_CA.'));
                return { status: 'skipped', reason: 'no eligible numbers available' };
            }
            const number = await this.attachNumber(companyId, candidates[0].phoneNumber, candidates[0].region);
            this.logger.log(`Auto-provisioned ${number.phoneNumber} for company ${companyId}`);
            return { status: 'attached', number };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.error(`Auto-provision failed for company ${companyId}: ${message}`);
            return { status: 'failed', reason: message };
        }
    }
    async purgeForCompany(companyId) {
        const active = await this.getActiveNumber(companyId);
        if (active) {
            try {
                await this.signalwire.releaseNumber(active.sid);
            }
            catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                this.logger.error(`PHONE ORPHAN companyId=${companyId} sid=${active.sid} ` +
                    `number=${active.phoneNumber} — release during permanent delete failed ` +
                    `(${message}), manual cleanup required`);
            }
        }
        await this.prisma.supportNumber.deleteMany({ where: { companyId } });
    }
    async assertProvisionable(companyId) {
        const company = await this.prisma.company.findUnique({
            where: { id: companyId },
            select: {
                id: true,
                businessName: true,
                country: true,
                isInternal: true,
                deletedAt: true,
            },
        });
        if (!company || company.deletedAt) {
            throw new common_1.NotFoundException(`Company ${companyId} not found`);
        }
        if (company.isInternal) {
            throw new common_1.BadRequestException('The Cyg Finance workspace cannot have a phone number');
        }
        return company;
    }
    async underDailyCap() {
        const max = (0, phone_config_js_1.maxPurchasesPerDay)(process.env);
        if (max <= 0)
            return false;
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const used = await this.prisma.supportNumber.count({
            where: { createdAt: { gte: since } },
        });
        return used < max;
    }
};
exports.PhoneProvisioningService = PhoneProvisioningService;
exports.PhoneProvisioningService = PhoneProvisioningService = PhoneProvisioningService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signalwire_service_js_1.SignalWireService])
], PhoneProvisioningService);
//# sourceMappingURL=phone-provisioning.service.js.map