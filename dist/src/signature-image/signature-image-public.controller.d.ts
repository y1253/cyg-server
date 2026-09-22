import type { Response } from 'express';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { SignatureImageService } from './signature-image.service.js';
export declare class SignatureImagePublicController {
    private readonly images;
    private readonly storage;
    constructor(images: SignatureImageService, storage: ObjectStorageService);
    serve(publicId: string, range: string, res: Response): Promise<void>;
}
