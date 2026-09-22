import type { Readable } from 'stream';
import { type StorageDriver } from './storage.config.js';
export interface ByteRange {
    start: number;
    end: number;
}
export interface ObjectInfo {
    size: number;
    contentType?: string;
}
export declare class ObjectStorageService {
    private readonly logger;
    private readonly config;
    readonly driver: StorageDriver;
    private client;
    constructor();
    private s3;
    assertKey(key: string): void;
    putBuffer(key: string, body: Buffer, contentType?: string): Promise<void>;
    putFile(key: string, absolutePath: string, contentType?: string): Promise<void>;
    head(key: string): Promise<ObjectInfo | null>;
    getStream(key: string, range: ByteRange | null): Promise<Readable>;
    getBuffer(key: string): Promise<Buffer>;
    delete(key: string): Promise<void>;
    private bucket;
    private isNotFound;
}
