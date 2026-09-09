import { EmailSignatureService } from './email-signature.service.js';
import { UpdateSignatureDefaultsDto } from './dto/update-signature-defaults.dto.js';
import { UpdateCompanyEmailSignatureDto } from './dto/update-company-signature.dto.js';
import { PreviewSignatureDto } from './dto/preview-signature.dto.js';
export declare class EmailSignatureController {
    private readonly signatures;
    constructor(signatures: EmailSignatureService);
    getDefaults(): Promise<{
        defaults: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            singleton: string;
            signatureHtml: string;
            signatureImageId: number;
        };
        placeholders: readonly [{
            readonly token: "{company name}";
            readonly label: "Company name";
            readonly key: "company";
            readonly example: "Acme Bookkeeping";
        }, {
            readonly token: "{support number}";
            readonly label: "Support number";
            readonly key: "phone";
            readonly example: "+1 438 256 1210";
        }, {
            readonly token: "{billing email}";
            readonly label: "Billing email";
            readonly key: "email";
            readonly example: "billing@acme.com";
        }, {
            readonly token: "{accountant}";
            readonly label: "Accountant";
            readonly key: "accountant";
            readonly example: "Dana Levy";
        }, {
            readonly token: "{accountant email}";
            readonly label: "Accountant email";
            readonly key: "accountantemail";
            readonly example: "dana@cygfinance.com";
        }, {
            readonly token: "{accountant phone}";
            readonly label: "Accountant phone";
            readonly key: "accountantphone";
            readonly example: "+1 514 555 0100";
        }, {
            readonly token: "{logo}";
            readonly label: "Logo";
            readonly key: "logo";
            readonly example: "[logo]";
        }];
    }>;
    updateDefaults(dto: UpdateSignatureDefaultsDto): Promise<{
        defaults: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            singleton: string;
            signatureHtml: string;
            signatureImageId: number;
        };
        placeholders: readonly [{
            readonly token: "{company name}";
            readonly label: "Company name";
            readonly key: "company";
            readonly example: "Acme Bookkeeping";
        }, {
            readonly token: "{support number}";
            readonly label: "Support number";
            readonly key: "phone";
            readonly example: "+1 438 256 1210";
        }, {
            readonly token: "{billing email}";
            readonly label: "Billing email";
            readonly key: "email";
            readonly example: "billing@acme.com";
        }, {
            readonly token: "{accountant}";
            readonly label: "Accountant";
            readonly key: "accountant";
            readonly example: "Dana Levy";
        }, {
            readonly token: "{accountant email}";
            readonly label: "Accountant email";
            readonly key: "accountantemail";
            readonly example: "dana@cygfinance.com";
        }, {
            readonly token: "{accountant phone}";
            readonly label: "Accountant phone";
            readonly key: "accountantphone";
            readonly example: "+1 514 555 0100";
        }, {
            readonly token: "{logo}";
            readonly label: "Logo";
            readonly key: "logo";
            readonly example: "[logo]";
        }];
    }>;
    getForCompany(companyId: number): Promise<import("./email-signature.service.js").CompanyEmailSignatureView>;
    updateForCompany(companyId: number, dto: UpdateCompanyEmailSignatureDto): Promise<import("./email-signature.service.js").CompanyEmailSignatureView>;
    resetForCompany(companyId: number): Promise<import("./email-signature.service.js").CompanyEmailSignatureView>;
    preview(dto: PreviewSignatureDto): Promise<{
        html: string;
    }>;
}
