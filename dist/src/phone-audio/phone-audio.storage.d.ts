export declare const PHONE_AUDIO_SUBDIR = "phone-audio";
export declare const PHONE_AUDIO_DIR: string;
export declare const MAX_AUDIO_BYTES: number;
export declare const PHONE_AUDIO_MULTER_LIMITS: {
    fileSize: number;
    files: number;
};
export declare function audioFileFilter(_req: unknown, file: {
    mimetype: string;
    originalname: string;
}, cb: (error: Error | null, acceptFile: boolean) => void): void;
export declare const phoneAudioStorage: any;
export declare function ensurePhoneAudioDir(): void;
export declare function newAudioStoragePath(): string;
