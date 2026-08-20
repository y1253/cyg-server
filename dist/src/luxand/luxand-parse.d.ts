export type LuxandJson = Record<string, unknown> | unknown[] | null;
export declare function extractScore(data: LuxandJson): number | null;
export declare function normalizeScore(score: number): number;
export declare function extractId(data: LuxandJson): string | null;
export declare function isFailureEnvelope(data: LuxandJson): boolean;
export declare function failureMessage(data: LuxandJson, raw: string): string;
export declare function describeLuxandError(message: string): string;
export declare function isImageRejection(message: string): boolean;
