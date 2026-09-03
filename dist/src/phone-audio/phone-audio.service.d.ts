import { PrismaService } from '../prisma/prisma.service.js';
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
    private readonly logger;
    constructor(prisma: PrismaService);
    list(): Promise<PhoneAudioView[]>;
    create(file: UploadedAudio, name: string | undefined, uploadedById: number): Promise<PhoneAudioView>;
    rename(id: number, name: string): Promise<PhoneAudioView>;
    remove(id: number): Promise<void>;
    resolve(settingValue: number | null | undefined): Promise<{
        id: number;
        name: string;
        createdAt: Date;
        deletedAt: Date | null;
        durationMs: number;
        filename: string;
        mimeType: string;
        size: number;
        storagePath: string;
        uploadedById: number | null;
    } | null>;
    streamable(id: number): Promise<{
        absolutePath: string;
        mimeType: string;
        filename: string;
    }>;
    private getOrThrow;
    private defaultName;
    private toView;
}
export {};
