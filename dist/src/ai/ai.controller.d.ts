import { AiService } from './ai.service.js';
import { PolishReplyDto } from './dto/polish-reply.dto.js';
export declare class AiController {
    private readonly aiService;
    constructor(aiService: AiService);
    polishReply(dto: PolishReplyDto): Promise<{
        polished: string;
    }>;
}
