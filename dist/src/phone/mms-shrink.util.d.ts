export interface ImageRung {
    edge: number;
    quality: number;
}
export declare const MMS_IMAGE_LADDER: readonly ImageRung[];
export declare function perFileBudget(total: number, fileCount: number): number;
export declare function isMmsImage(mimetype: string | undefined, filename: string | undefined): boolean;
