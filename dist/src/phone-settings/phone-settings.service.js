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
var PhoneSettingsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PhoneSettingsService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const phone_hours_util_js_1 = require("./phone-hours.util.js");
const phone_message_util_js_1 = require("./phone-message.util.js");
const phone_settings_util_js_1 = require("./phone-settings.util.js");
let PhoneSettingsService = PhoneSettingsService_1 = class PhoneSettingsService {
    prisma;
    logger = new common_1.Logger(PhoneSettingsService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getDefaults() {
        return this.prisma.phoneSettingsDefault.upsert({
            where: { singleton: phone_settings_util_js_1.SETTINGS_SINGLETON },
            update: {},
            create: {
                singleton: phone_settings_util_js_1.SETTINGS_SINGLETON,
                ...phone_settings_util_js_1.SEED_DEFAULTS,
                weeklyHours: phone_settings_util_js_1.SEED_DEFAULTS.weeklyHours,
            },
        });
    }
    async updateDefaults(dto) {
        await this.getDefaults();
        const data = this.pickPresent(dto);
        return this.prisma.phoneSettingsDefault.update({
            where: { singleton: phone_settings_util_js_1.SETTINGS_SINGLETON },
            data,
        });
    }
    async getForCompany(companyId) {
        const company = await this.assertCompany(companyId);
        const [globalRow, overrideRow] = await Promise.all([
            this.getDefaults(),
            this.prisma.companyPhoneSettings.findUnique({ where: { companyId } }),
        ]);
        return this.buildView(company, globalRow, overrideRow);
    }
    async updateForCompany(companyId, dto) {
        const company = await this.assertCompany(companyId);
        const data = this.pickPresent(dto);
        const [globalRow, overrideRow] = await Promise.all([
            this.getDefaults(),
            this.prisma.companyPhoneSettings.upsert({
                where: { companyId },
                update: data,
                create: { companyId, ...data },
            }),
        ]);
        return this.buildView(company, globalRow, overrideRow);
    }
    async resetForCompany(companyId) {
        const company = await this.assertCompany(companyId);
        const cleared = Object.fromEntries(phone_settings_util_js_1.SETTINGS_FIELDS.map((key) => [key, null]));
        const [globalRow, overrideRow] = await Promise.all([
            this.getDefaults(),
            this.prisma.companyPhoneSettings.upsert({
                where: { companyId },
                update: cleared,
                create: { companyId, ...cleared },
            }),
        ]);
        return this.buildView(company, globalRow, overrideRow);
    }
    async effectiveFor(companyId) {
        try {
            const [globalRow, overrideRow] = await Promise.all([
                this.prisma.phoneSettingsDefault.findUnique({
                    where: { singleton: phone_settings_util_js_1.SETTINGS_SINGLETON },
                }),
                companyId === null
                    ? Promise.resolve(null)
                    : this.prisma.companyPhoneSettings.findUnique({ where: { companyId } }),
            ]);
            return (0, phone_settings_util_js_1.resolveSettings)(globalRow, overrideRow).effective;
        }
        catch (error) {
            this.logger.error(`phone settings lookup failed for company ${companyId ?? 'unknown'} — ` +
                `falling back to built-in defaults: ${String(error)}`);
            return phone_settings_util_js_1.HARDCODED_FALLBACK;
        }
    }
    async preview(template, companyId, at) {
        const when = at ? new Date(at) : new Date();
        const instant = Number.isNaN(when.getTime()) ? new Date() : when;
        let companyName = 'Acme Bookkeeping';
        let phone = '+14382561210';
        if (companyId !== undefined) {
            const company = await this.prisma.company.findFirst({
                where: { id: companyId, deletedAt: null },
                select: { businessName: true, supportNumber: true },
            });
            if (company) {
                companyName = company.businessName;
                phone = company.supportNumber ?? phone;
            }
        }
        const settings = await this.effectiveFor(companyId ?? null);
        return {
            text: (0, phone_message_util_js_1.renderMessage)(template, {
                company: companyName,
                phone,
                hours: (0, phone_hours_util_js_1.describeToday)(settings.weeklyHours, settings.timezone, instant),
            }),
            isOpen: (0, phone_hours_util_js_1.isOpenAt)(settings.weeklyHours, settings.timezone, instant),
        };
    }
    pickPresent(dto) {
        const data = {};
        for (const key of phone_settings_util_js_1.SETTINGS_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(dto, key))
                continue;
            const value = dto[key];
            if (value === undefined)
                continue;
            data[key] =
                key === 'weeklyHours' && value === null
                    ? client_1.Prisma.DbNull
                    : value;
        }
        return data;
    }
    async assertCompany(companyId) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
            select: { id: true, businessName: true, isInternal: true, supportNumber: true },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        if (company.isInternal) {
            throw new common_1.BadRequestException('Internal workspaces have no phone line and no phone settings');
        }
        return company;
    }
    buildView(company, globalRow, overrideRow) {
        const { effective, source } = (0, phone_settings_util_js_1.resolveSettings)(globalRow, overrideRow);
        const defaults = (0, phone_settings_util_js_1.resolveSettings)(globalRow, null).effective;
        const now = new Date();
        const overrides = Object.fromEntries(phone_settings_util_js_1.SETTINGS_FIELDS.map((key) => [key, overrideRow?.[key] ?? null]));
        return {
            companyId: company.id,
            companyName: company.businessName,
            overrides,
            effective,
            source,
            defaults,
            isOpenNow: (0, phone_hours_util_js_1.isOpenAt)(effective.weeklyHours, effective.timezone, now),
            hoursToday: (0, phone_hours_util_js_1.describeToday)(effective.weeklyHours, effective.timezone, now),
            placeholders: phone_message_util_js_1.PLACEHOLDERS,
        };
    }
};
exports.PhoneSettingsService = PhoneSettingsService;
exports.PhoneSettingsService = PhoneSettingsService = PhoneSettingsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], PhoneSettingsService);
//# sourceMappingURL=phone-settings.service.js.map