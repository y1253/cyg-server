import { PrismaService } from '../prisma/prisma.service.js';
import { type ImageScope } from './signature-image.util.js';
export interface SignatureImageView {
    id: number;
    name: string;
    filename: string;
    size: number;
    width: number;
    height: number;
    createdAt: string;
    url: string;
    companyId: number | null;
}
export declare class SignatureImageService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    list(scope?: ImageScope): Promise<SignatureImageView[]>;
    create(file: {
        buffer: Buffer;
        originalname: string;
    }, name: string | undefined, uploadedById: number, scope?: ImageScope): Promise<SignatureImageView>;
    rename(id: number, name: string, scope?: ImageScope): Promise<SignatureImageView>;
    remove(id: number, scope?: ImageScope): Promise<void>;
    urlFor(settingValue: number | null | undefined, scope?: ImageScope): Promise<string | null>;
    streamableByPublicId(publicId: string): Promise<{
        absolutePath: string;
        mimeType: string;
        filename: string;
    }>;
    assertUsableBy(settingValue: unknown, scope: ImageScope): Promise<void>;
    private assertScopeCompany;
    private getInLibraryOrThrow;
    private getOrThrow;
    private toView;
}
