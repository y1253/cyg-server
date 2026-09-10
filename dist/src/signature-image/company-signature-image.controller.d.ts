import { SignatureImageService } from './signature-image.service.js';
type AuthedRequest = {
    user: {
        userId: number;
    };
};
export declare class CompanySignatureImageController {
    private readonly images;
    constructor(images: SignatureImageService);
    list(companyId: number): Promise<import("./signature-image.service.js").SignatureImageView[]>;
    upload(companyId: number, file: {
        buffer: Buffer;
        originalname: string;
    } | undefined, name: string | undefined, req: AuthedRequest): Promise<import("./signature-image.service.js").SignatureImageView>;
    rename(companyId: number, id: number, name: string | undefined): Promise<import("./signature-image.service.js").SignatureImageView>;
    remove(companyId: number, id: number): Promise<void>;
}
export {};
