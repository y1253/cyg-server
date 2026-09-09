import { SignatureImageService } from './signature-image.service.js';
type AuthedRequest = {
    user: {
        userId: number;
    };
};
export declare class SignatureImageController {
    private readonly images;
    constructor(images: SignatureImageService);
    list(): Promise<import("./signature-image.service.js").SignatureImageView[]>;
    upload(file: {
        buffer: Buffer;
        originalname: string;
    } | undefined, name: string | undefined, req: AuthedRequest): Promise<import("./signature-image.service.js").SignatureImageView>;
    rename(id: number, name: string | undefined): Promise<import("./signature-image.service.js").SignatureImageView>;
    remove(id: number): Promise<void>;
}
export {};
