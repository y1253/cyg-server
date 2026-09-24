import { AiService } from './ai.service.js';
import { PolishReplyDto } from './dto/polish-reply.dto.js';
import { TranslateDto } from './dto/translate.dto.js';
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    config(): {
        assist: boolean;
        transcribeInbound: boolean;
        dictationLive: boolean;
    };
    polishReply(dto: PolishReplyDto): Promise<{
        polished: string;
    }>;
    transcribe(file?: {
        buffer: Buffer;
        originalname: string;
        mimetype: string;
    }): Promise<{
        text: string;
    }>;
    translate(dto: TranslateDto): Promise<{
        translated: string;
    }>;
}
