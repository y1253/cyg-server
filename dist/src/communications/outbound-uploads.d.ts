export declare const OUTBOUND_SUBDIR = "outbound";
export declare const MAX_OUTBOUND_FILE_BYTES: number;
export declare const INLINE_BUDGET_BYTES: number;
export interface OutboundFile {
    originalname: string;
    mimetype: string;
    size: number;
    path: string;
}
export declare function ensureOutboundDir(): void;
export declare const outboundAttachmentStorage: any;
export declare const OUTBOUND_MULTER_LIMITS: {
    fileSize: number;
    fieldSize: number;
};
export declare function splitBySizeBudget<T extends {
    size: number;
}>(files: T[], budget?: number): {
    inline: T[];
    linked: T[];
};
export declare function discardOutboundFiles(files: Array<{
    path?: string;
}> | undefined): Promise<void>;
export declare function sweepStaleOutboundFiles(maxAgeMs?: number): Promise<number>;
