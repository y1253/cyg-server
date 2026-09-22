import { AiService } from './ai.service.js';
export declare class AiDocumentService {
    private readonly ai;
    constructor(ai: AiService);
    summarize(input: {
        bytes: Buffer;
        mimeType: string;
        filename: string;
    }): Promise<{
        summary: string;
    }>;
    private partsFor;
}
