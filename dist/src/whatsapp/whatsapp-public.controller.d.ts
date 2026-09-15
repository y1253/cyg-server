import { type RawBodyRequest } from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { WhatsAppMessagesService } from './whatsapp-messages.service.js';
export declare class WhatsAppPublicController {
    private readonly messages;
    private readonly logger;
    constructor(messages: WhatsAppMessagesService);
    verify(query: Record<string, string | undefined>, res: Response): void;
    receive(req: RawBodyRequest<ExpressRequest>, signature: string | undefined): string;
    media(messageId: number, token: string, variant: string | undefined, download: string | undefined, range: string | undefined, res: Response): Promise<void>;
}
