import type { IsoCountry } from './signalwire-parse.js';
export declare function parseRegions(csv: string | undefined | null): string[];
export declare function regionsFor(country: IsoCountry, env: Record<string, string | undefined>): string[];
export declare function webhookBase(env: Record<string, string | undefined>): string;
export declare function webhookUrls(env: Record<string, string | undefined>): {
    voiceUrl: string;
    smsUrl: string;
    statusCallback: string;
    dialStatusUrl: string;
    voicemailUrl: string;
};
export declare function maxPurchasesPerDay(env: Record<string, string | undefined>): number;
export declare function sipCredentials(env: Record<string, string | undefined>): {
    domain: string;
    username: string;
    password: string;
    wsServer: string;
} | null;
export declare function sipDialTarget(env: Record<string, string | undefined>): string | null;
export declare function recordMode(env: Record<string, string | undefined>): string | undefined;
export declare function summarizeCalls(env: Record<string, string | undefined>): boolean;
export declare function transcribeModel(env: Record<string, string | undefined>): string;
export declare function summaryModel(env: Record<string, string | undefined>): string;
