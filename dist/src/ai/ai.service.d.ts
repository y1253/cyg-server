import { ConfigService } from '@nestjs/config';
import { PolishReplyDto } from './dto/polish-reply.dto.js';
export declare class AiService {
    private readonly apiUrl;
    private readonly apiKey;
    private readonly model;
    constructor(config: ConfigService);
    polishReply(dto: PolishReplyDto): Promise<{
        polished: string;
    }>;
}
