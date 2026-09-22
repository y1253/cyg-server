import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
export interface PhoneAudioView {
    id: number;
    name: string;
    filename: string;
    size: number;
    durationMs: number;
    createdAt: Date;
}
interface UploadedAudio {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
}
export declare class PhoneAudioService {
    private readonly prisma;
    private readonly storage;
    private readonly logger;
    constructor(prisma: PrismaService, storage: ObjectStorageService);
    list(): Promise<PhoneAudioView[]>;
    create(file: UploadedAudio, name: string | undefined, uploadedById: number): Promise<PhoneAudioView>;
    rename(id: number, name: string): Promise<PhoneAudioView>;
    remove(id: number): Promise<void>;
    resolve(settingValue: number | null | undefined): Promise<{
        name: string;
        size: number;
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        filename: string;
        mimeType: string;
        storagePath: string;
        uploadedById: number | null;
        durationMs: number;
    } | null>;
    streamable(id: number): Promise<{
        storageKey: string;
        mimeType: string;
        filename: string;
    }>;
    private getOrThrow;
    private defaultName;
    private toView;
}
export {};
