export declare const SIGNATURE_IMAGE_SUBDIR = "signature-images";
export declare const SIGNATURE_IMAGE_DIR: string;
export declare const MAX_IMAGE_BYTES: number;
export declare const SIGNATURE_IMAGE_MULTER_LIMITS: {
    fileSize: number;
    files: number;
};
export declare function imageFileFilter(_req: unknown, file: {
    mimetype: string;
    originalname: string;
}, cb: (error: Error | null, acceptFile: boolean) => void): void;
export declare const signatureImageStorage: any;
export declare function ensureSignatureImageDir(): void;
export declare function newImageStoragePath(): string;
