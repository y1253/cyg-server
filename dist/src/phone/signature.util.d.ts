export declare const SIGNATURE_HEADER = "x-twilio-signature";
export declare function signatureBase(url: string, params: Record<string, unknown>): string;
export declare function computeSignature(url: string, params: Record<string, unknown>, authToken: string): string;
export declare function verifySignature(signature: string | undefined, url: string, params: Record<string, unknown>, authToken: string | undefined): boolean;
