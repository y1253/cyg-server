import { ConfidentialClientApplication } from '@azure/msal-node';
export type MicrosoftConnectKind = 'work' | 'personal';
export declare const MS_BASE_SCOPES: string[];
export declare const MS_TEAMS_SCOPES: string[];
export declare function scopesFor(kind: MicrosoftConnectKind): string[];
export declare function getMicrosoftRedirectUri(): string;
export declare function makeConfidentialClient(): ConfidentialClientApplication;
export declare function buildMicrosoftAuthUrl(state: string, kind: MicrosoftConnectKind): Promise<string>;
export interface MicrosoftTokens {
    accessToken: string;
    refreshToken: string | null;
    expiresOn: Date;
    email: string | null;
    userId: string | null;
    scopes: string[];
}
export declare function redeemMicrosoftCode(code: string, kind: MicrosoftConnectKind): Promise<MicrosoftTokens>;
export declare function refreshMicrosoftTokens(refreshToken: string, scopes: string[]): Promise<MicrosoftTokens>;
