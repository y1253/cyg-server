import { PrismaService } from '../prisma/prisma.service.js';
import { SignatureImageService } from '../signature-image/signature-image.service.js';
import { EffectiveEmailSignature, EmailSignatureOverrides, SignatureSource } from './email-signature.util.js';
import { PLACEHOLDERS } from './signature-template.util.js';
import { UpdateSignatureDefaultsDto } from './dto/update-signature-defaults.dto.js';
import { UpdateCompanyEmailSignatureDto } from './dto/update-company-signature.dto.js';
export interface CompanyEmailSignatureView {
    companyId: number;
    companyName: string;
    overrides: EmailSignatureOverrides;
    effective: EffectiveEmailSignature;
    source: SignatureSource;
    defaults: EffectiveEmailSignature;
    placeholders: typeof PLACEHOLDERS;
    previewHtml: string;
}
export declare class EmailSignatureService {
    private readonly prisma;
    private readonly images;
    private readonly logger;
    constructor(prisma: PrismaService, images: SignatureImageService);
    getDefaults(): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        singleton: string;
        signatureHtml: string;
        signatureImageId: number;
    }>;
    updateDefaults(dto: UpdateSignatureDefaultsDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        singleton: string;
        signatureHtml: string;
        signatureImageId: number;
    }>;
    getForCompany(companyId: number): Promise<CompanyEmailSignatureView>;
    updateForCompany(companyId: number, dto: UpdateCompanyEmailSignatureDto): Promise<CompanyEmailSignatureView>;
    resetForCompany(companyId: number): Promise<CompanyEmailSignatureView>;
    renderForCompany(companyId: number): Promise<string>;
    preview(template: string, companyId?: number, signatureImageId?: number): Promise<{
        html: string;
    }>;
    private wrap;
    private companyVars;
    private pickPresent;
    private assertCompany;
    private buildView;
}
