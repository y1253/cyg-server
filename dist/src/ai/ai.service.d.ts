import { ConfigService } from '@nestjs/config';
import { PolishReplyDto } from './dto/polish-reply.dto.js';
export declare class AiService {
    private readonly chatUrl;
    private readonly transcribeUrl;
    private readonly apiKey;
    private readonly model;
    constructor(config: ConfigService);
    polishReply(dto: PolishReplyDto): Promise<{
        polished: string;
    }>;
    transcribeAudio(audio: Buffer, filename: string, mimeType?: string): Promise<string>;
    summarizeCall(transcript: string, model: string): Promise<string>;
    private get transcribeModelId();
    private chat;
}
