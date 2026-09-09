import type { Response } from 'express';
import { SignatureImageService } from './signature-image.service.js';
export declare class SignatureImagePublicController {
    private readonly images;
    constructor(images: SignatureImageService);
    serve(publicId: string, range: string, res: Response): Promise<void>;
}
