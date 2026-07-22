export declare function generateOAuthState(companyId: number, userId: number, extra?: Record<string, string>): string;
export declare function verifyOAuthState(state: string): {
    companyId: number;
    userId: number;
    kind?: string;
};
