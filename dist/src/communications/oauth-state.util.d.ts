export declare function generateOAuthState(companyId: number, userId: number): string;
export declare function verifyOAuthState(state: string): {
    companyId: number;
    userId: number;
};
