import { PrismaService } from '../prisma/prisma.service.js';
export interface SignatureImageView {
    id: number;
    name: string;
    filename: string;
    size: number;
    width: number;
    height: number;
    createdAt: string;
    url: string;
}
export declare class SignatureImageService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    list(): Promise<SignatureImageView[]>;
    create(file: {
        buffer: Buffer;
        originalname: string;
    }, name: string | undefined, uploadedById: number): Promise<SignatureImageView>;
    rename(id: number, name: string): Promise<SignatureImageView>;
    remove(id: number): Promise<void>;
    urlFor(settingValue: number | null | undefined): Promise<string | null>;
    streamableByPublicId(publicId: string): Promise<{
        absolutePath: string;
        mimeType: string;
        filename: string;
    }>;
    private getOrThrow;
    private toView;
}
