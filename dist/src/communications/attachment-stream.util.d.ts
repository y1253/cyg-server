import type { Response } from 'express';
export declare function sanitizeMime(mime: string | undefined): string;
export declare function sanitizeFilename(name: string | undefined): string;
export declare function verifyQueryToken(token: string | undefined): void;
export declare function streamAttachment(res: Response, buf: Buffer, mimeType: string | undefined, filename: string | undefined, disposition: string | undefined, range?: string): void;
export declare function transcodeAudioToMp3(input: Buffer): Promise<Buffer>;
