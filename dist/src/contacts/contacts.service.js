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
var ContactsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const company_target_util_js_1 = require("../companies/company-target.util.js");
const phone_number_util_js_1 = require("../phone/phone-number.util.js");
const auto_contacts_util_js_1 = require("./auto-contacts.util.js");
const INTERNAL_MESSAGE = 'The Cyg Finance workspace has no phone line, so it has no contacts';
let ContactsService = ContactsService_1 = class ContactsService {
    prisma;
    logger = new common_1.Logger(ContactsService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findByCompany(companyId) {
        await (0, company_target_util_js_1.assertRealCompany)(this.prisma, companyId, INTERNAL_MESSAGE);
        return this.prisma.contact.findMany({
            where: { companyId, deletedAt: null },
            orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });
    }
    async create(dto) {
        await (0, company_target_util_js_1.assertRealCompany)(this.prisma, dto.companyId, INTERNAL_MESSAGE);
        return this.prisma.contact.create({
            data: {
                companyId: dto.companyId,
                name: dto.name.trim(),
                phone: dto.phone.trim(),
                phoneE164: (0, phone_number_util_js_1.toE164)(dto.phone),
                email: dto.email?.trim() || null,
                note: dto.note?.trim() || null,
                autoSource: null,
            },
        });
    }
    async update(id, dto) {
        const existing = await this.getOrThrow(id);
        return this.prisma.contact.update({
            where: { id: existing.id },
            data: {
                ...(dto.name !== undefined && { name: dto.name.trim() }),
                ...(dto.phone !== undefined && {
                    phone: dto.phone.trim(),
                    phoneE164: (0, phone_number_util_js_1.toE164)(dto.phone),
                }),
                ...(dto.email !== undefined && { email: dto.email?.trim() || null }),
                ...(dto.note !== undefined && { note: dto.note?.trim() || null }),
            },
        });
    }
    async remove(id) {
        const existing = await this.getOrThrow(id);
        await this.prisma.contact.update({
            where: { id: existing.id },
            data: { deletedAt: new Date() },
        });
    }
    async nameForNumber(companyId, rawNumber) {
        const e164 = (0, phone_number_util_js_1.toE164)(rawNumber);
        if (!e164)
            return null;
        try {
            const row = await this.prisma.contact.findFirst({
                where: { companyId, deletedAt: null, phoneE164: e164 },
                select: { name: true },
                orderBy: { name: 'asc' },
            });
            return row?.name ?? null;
        }
        catch (err) {
            this.logger.warn(`nameForNumber(${companyId}) failed, the call will show a number: ${String(err)}`);
            return null;
        }
    }
    async syncAutoContacts(companyId) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null, isInternal: false },
            select: {
                contactInfo: {
                    select: { personalName: true, privatePhone: true, storeNumber: true },
                },
                accountant: { select: { name: true, phone: true } },
            },
        });
        if (!company)
            return;
        const desired = (0, auto_contacts_util_js_1.desiredAutoContacts)(company);
        const wanted = new Map(desired.map((d) => [d.autoSource, d]));
        for (const source of auto_contacts_util_js_1.AUTO_SOURCES) {
            const seed = wanted.get(source);
            if (!seed) {
                await this.prisma.contact.updateMany({
                    where: { companyId, autoSource: source, deletedAt: null },
                    data: { deletedAt: new Date() },
                });
                continue;
            }
            const data = {
                name: seed.name,
                phone: seed.phone,
                phoneE164: (0, phone_number_util_js_1.toE164)(seed.phone),
                deletedAt: null,
            };
            await this.prisma.contact.upsert({
                where: { companyId_autoSource: { companyId, autoSource: source } },
                create: { companyId, autoSource: source, ...data },
                update: data,
            });
        }
    }
    async syncAutoContactsQuietly(companyId) {
        try {
            await this.syncAutoContacts(companyId);
        }
        catch (err) {
            this.logger.error(`syncAutoContacts failed for company ${companyId}: ${String(err)}`);
        }
    }
    async getOrThrow(id) {
        const contact = await this.prisma.contact.findFirst({
            where: { id, deletedAt: null },
        });
        if (!contact)
            throw new common_1.NotFoundException('Contact not found');
        return contact;
    }
};
exports.ContactsService = ContactsService;
exports.ContactsService = ContactsService = ContactsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], ContactsService);
//# sourceMappingURL=contacts.service.js.map