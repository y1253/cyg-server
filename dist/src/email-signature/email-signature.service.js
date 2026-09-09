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
var EmailSignatureService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailSignatureService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const signature_image_service_js_1 = require("../signature-image/signature-image.service.js");
const email_signature_util_js_1 = require("./email-signature.util.js");
const signature_template_util_js_1 = require("./signature-template.util.js");
let EmailSignatureService = EmailSignatureService_1 = class EmailSignatureService {
    prisma;
    images;
    logger = new common_1.Logger(EmailSignatureService_1.name);
    constructor(prisma, images) {
        this.prisma = prisma;
        this.images = images;
    }
    async getDefaults() {
        return this.prisma.emailSignatureDefault.upsert({
            where: { singleton: email_signature_util_js_1.SETTINGS_SINGLETON },
            update: {},
            create: { singleton: email_signature_util_js_1.SETTINGS_SINGLETON, ...email_signature_util_js_1.SEED_DEFAULTS },
        });
    }
    async updateDefaults(dto) {
        await this.getDefaults();
        const data = this.pickPresent(dto);
        return this.prisma.emailSignatureDefault.update({
            where: { singleton: email_signature_util_js_1.SETTINGS_SINGLETON },
            data,
        });
    }
    async getForCompany(companyId) {
        const company = await this.assertCompany(companyId);
        const [globalRow, overrideRow] = await Promise.all([
            this.getDefaults(),
            this.prisma.companyEmailSignature.findUnique({ where: { companyId } }),
        ]);
        return this.buildView(company, globalRow, overrideRow);
    }
    async updateForCompany(companyId, dto) {
        const company = await this.assertCompany(companyId);
        const data = this.pickPresent(dto);
        const [globalRow, overrideRow] = await Promise.all([
            this.getDefaults(),
            this.prisma.companyEmailSignature.upsert({
                where: { companyId },
                update: data,
                create: { companyId, ...data },
            }),
        ]);
        return this.buildView(company, globalRow, overrideRow);
    }
    async resetForCompany(companyId) {
        const company = await this.assertCompany(companyId);
        const cleared = Object.fromEntries(email_signature_util_js_1.SIGNATURE_FIELDS.map((key) => [key, null]));
        const [globalRow, overrideRow] = await Promise.all([
            this.getDefaults(),
            this.prisma.companyEmailSignature.upsert({
                where: { companyId },
                update: cleared,
                create: { companyId, ...cleared },
            }),
        ]);
        return this.buildView(company, globalRow, overrideRow);
    }
    async renderForCompany(companyId) {
        try {
            const [globalRow, overrideRow, company] = await Promise.all([
                this.prisma.emailSignatureDefault.findUnique({
                    where: { singleton: email_signature_util_js_1.SETTINGS_SINGLETON },
                }),
                this.prisma.companyEmailSignature.findUnique({ where: { companyId } }),
                this.companyVars(companyId),
            ]);
            const { effective } = (0, email_signature_util_js_1.resolveSignature)(globalRow, overrideRow);
            if (!effective.signatureHtml)
                return '';
            const logoUrl = await this.images.urlFor(effective.signatureImageId);
            return this.wrap((0, signature_template_util_js_1.renderSignature)(effective.signatureHtml, { ...company, logoUrl }));
        }
        catch (error) {
            this.logger.error(`email signature lookup failed for company ${companyId} — ` +
                `falling back to the built-in signature: ${String(error)}`);
            return this.wrap((0, signature_template_util_js_1.renderSignature)(email_signature_util_js_1.HARDCODED_FALLBACK.signatureHtml, {
                ...(await this.companyVars(companyId).catch(() => EMPTY_VARS)),
                logoUrl: null,
            }));
        }
    }
    async preview(template, companyId, signatureImageId) {
        const vars = companyId
            ? await this.companyVars(companyId).catch(() => SAMPLE_VARS)
            : SAMPLE_VARS;
        const logoUrl = await this.images.urlFor(signatureImageId);
        return {
            html: this.wrap((0, signature_template_util_js_1.renderSignature)((0, signature_template_util_js_1.sanitizeSignatureHtml)(template), { ...vars, logoUrl })),
        };
    }
    wrap(html) {
        return `<div data-cyg-signature="1">${html}</div>`;
    }
    async companyVars(companyId) {
        const company = await this.prisma.company.findUnique({
            where: { id: companyId },
            select: {
                businessName: true,
                supportNumber: true,
                billing: { select: { billingEmail: true } },
                accountant: {
                    select: { name: true, email: true, phone: true },
                },
            },
        });
        return {
            company: company?.businessName ?? '',
            phone: company?.supportNumber ?? '',
            email: company?.billing?.billingEmail ?? '',
            accountant: company?.accountant?.name ?? '',
            accountantemail: company?.accountant?.email ?? '',
            accountantphone: company?.accountant?.phone ?? '',
        };
    }
    pickPresent(dto) {
        const data = {};
        for (const key of email_signature_util_js_1.SIGNATURE_FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(dto, key))
                continue;
            const value = dto[key];
            if (value === undefined)
                continue;
            data[key] =
                key === 'signatureHtml' && typeof value === 'string'
                    ? (0, signature_template_util_js_1.sanitizeSignatureHtml)(value)
                    : value;
        }
        return data;
    }
    async assertCompany(companyId) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
            select: { id: true, businessName: true, isInternal: true },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        if (company.isInternal) {
            throw new common_1.BadRequestException('Internal workspaces send no email and have no signature');
        }
        return company;
    }
    async buildView(company, globalRow, overrideRow) {
        const { effective, source } = (0, email_signature_util_js_1.resolveSignature)(globalRow, overrideRow);
        const defaults = (0, email_signature_util_js_1.resolveSignature)(globalRow, null).effective;
        const overrides = Object.fromEntries(email_signature_util_js_1.SIGNATURE_FIELDS.map((key) => [key, overrideRow?.[key] ?? null]));
        const [vars, logoUrl] = await Promise.all([
            this.companyVars(company.id),
            this.images.urlFor(effective.signatureImageId),
        ]);
        return {
            companyId: company.id,
            companyName: company.businessName,
            overrides,
            effective,
            source,
            defaults,
            placeholders: signature_template_util_js_1.PLACEHOLDERS,
            previewHtml: effective.signatureHtml
                ? (0, signature_template_util_js_1.renderSignature)(effective.signatureHtml, { ...vars, logoUrl })
                : '',
        };
    }
};
exports.EmailSignatureService = EmailSignatureService;
exports.EmailSignatureService = EmailSignatureService = EmailSignatureService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        signature_image_service_js_1.SignatureImageService])
], EmailSignatureService);
const EMPTY_VARS = {
    company: '',
    phone: '',
    email: '',
    accountant: '',
    accountantemail: '',
    accountantphone: '',
};
const SAMPLE_VARS = {
    company: 'Acme Bookkeeping',
    phone: '+1 438 256 1210',
    email: 'billing@acme.com',
    accountant: 'Dana Levy',
    accountantemail: 'dana@cygfinance.com',
    accountantphone: '+1 514 555 0100',
};
//# sourceMappingURL=email-signature.service.js.map