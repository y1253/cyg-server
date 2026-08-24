export declare const UPLOADS_ROOT: string;
export declare const MESSAGES_SUBDIR = "messages";
export declare const MAX_ATTACHMENT_BYTES: number;
export declare const MESSAGE_MULTER_LIMITS: {
    fileSize: number;
    fieldSize: number;
};
export declare function ensureUploadDirs(): void;
export declare function resolveStoredPath(storagePath: string): string;
export declare const messageAttachmentStorage: any;
