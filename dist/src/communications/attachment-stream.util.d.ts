import type { Response } from 'express';
export declare function sanitizeMime(mime: string | undefined): string;
export declare function sanitizeFilename(name: string | undefined): string;
export declare function verifyQueryToken(token: string | undefined): void;
export declare function verifyQueryTokenUser(token: string | undefined): number;
export declare function streamAttachment(res: Response, buf: Buffer, mimeType: string | undefined, filename: string | undefined, disposition: string | undefined, range?: string): void;
export declare function streamAttachmentFile(res: Response, absolutePath: string, mimeType: string | undefined, filename: string | undefined, disposition: string | undefined, range?: string): Promise<void>;
export declare function transcodeAudioToMp3(input: Buffer): Promise<Buffer>;
