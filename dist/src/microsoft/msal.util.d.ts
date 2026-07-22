import { ConfidentialClientApplication } from '@azure/msal-node';
export declare const MS_SCOPES: string[];
export declare function getMicrosoftRedirectUri(): string;
export declare function makeConfidentialClient(): ConfidentialClientApplication;
export declare function buildMicrosoftAuthUrl(state: string): Promise<string>;
export interface MicrosoftTokens {
    accessToken: string;
    refreshToken: string | null;
    expiresOn: Date;
    email: string | null;
    userId: string | null;
    scopes: string[];
}
export declare function redeemMicrosoftCode(code: string): Promise<MicrosoftTokens>;
export declare function refreshMicrosoftTokens(refreshToken: string): Promise<MicrosoftTokens>;
