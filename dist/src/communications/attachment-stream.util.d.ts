import type { Readable } from 'stream';
import type { Response } from 'express';
export declare function sanitizeMime(mime: string | undefined): string;
export declare function sanitizeFilename(name: string | undefined): string;
export declare function verifyQueryToken(token: string | undefined): void;
export declare function verifyQueryTokenUser(token: string | undefined): number;
export declare function streamAttachment(res: Response, buf: Buffer, mimeType: string | undefined, filename: string | undefined, disposition: string | undefined, range?: string): void;
export declare function streamAttachmentFile(res: Response, absolutePath: string, mimeType: string | undefined, filename: string | undefined, disposition: string | undefined, range?: string, cacheControl?: string): Promise<void>;
export interface AttachmentObjectSource {
    head(key: string): Promise<{
        size: number;
    } | null>;
    getStream(key: string, range: {
        start: number;
        end: number;
    } | null): Promise<Readable>;
}
export declare function streamAttachmentStored(res: Response, storage: AttachmentObjectSource, key: string, mimeType: string | undefined, filename: string | undefined, disposition: string | undefined, range?: string, cacheControl?: string, fallbackPath?: string): Promise<void>;
export declare function runFfmpegDetailed(input: Buffer, args: string[]): Promise<{
    stdout: Buffer;
    stderr: string;
    code: number | null;
}>;
export declare function runFfmpeg(input: Buffer, args: string[]): Promise<Buffer>;
export declare function transcodeAudioToMp3(input: Buffer): Promise<Buffer>;
