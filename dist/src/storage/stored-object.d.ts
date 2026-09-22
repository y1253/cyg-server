import type { Response } from 'express';
import type { ObjectStorageService } from './object-storage.service.js';
export interface StoredStreamOptions {
    mimeType?: string;
    filename?: string;
    disposition?: string;
    range?: string;
    cacheControl?: string;
}
export declare function streamStoredObject(res: Response, storage: ObjectStorageService, key: string, opts?: StoredStreamOptions): Promise<void>;
