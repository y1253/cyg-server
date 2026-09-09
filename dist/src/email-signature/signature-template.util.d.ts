export declare const PLACEHOLDERS: readonly [{
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
export interface SignatureVars {
    company: string;
    phone: string;
    email: string;
    accountant: string;
    accountantemail: string;
    accountantphone: string;
    logoUrl: string | null;
}
export declare function escapeHtml(value: string): string;
export declare function renderSignature(template: string, vars: SignatureVars): string;
export declare function sanitizeSignatureHtml(html: string): string;
