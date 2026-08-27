export declare const SIGNATURE_HEADER = "x-signalwire-signature";
export declare const LEGACY_SIGNATURE_HEADER = "x-twilio-signature";
export declare function signatureBase(url: string, params: Record<string, unknown>): string;
export declare function computeSignature(url: string, params: Record<string, unknown>, signingKey: string): string;
export declare function verifySignature(signature: string | undefined, url: string, params: Record<string, unknown>, signingKey: string | undefined): boolean;
