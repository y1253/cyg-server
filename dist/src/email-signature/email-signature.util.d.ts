export interface EffectiveEmailSignature {
    signatureHtml: string;
    signatureImageId: number;
}
export type SignatureSource = Record<keyof EffectiveEmailSignature, 'company' | 'default'>;
export type EmailSignatureOverrides = {
    [K in keyof EffectiveEmailSignature]: EffectiveEmailSignature[K] | null;
};
export declare const SETTINGS_SINGLETON = "GLOBAL";
export declare const SIGNATURE_FIELDS: readonly ["signatureHtml", "signatureImageId"];
export declare const SEED_DEFAULTS: EffectiveEmailSignature;
export declare const HARDCODED_FALLBACK: EffectiveEmailSignature;
export type RawSignatureDefaults = EffectiveEmailSignature;
export type RawSignatureOverrides = {
    [K in keyof EffectiveEmailSignature]?: EffectiveEmailSignature[K] | null;
};
export declare function resolveSignature(global: RawSignatureDefaults | null, company: RawSignatureOverrides | null): {
    effective: EffectiveEmailSignature;
    source: SignatureSource;
};
export declare function imageIdOrNone(value: number | null | undefined): number | null;
