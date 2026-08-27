import type { Request } from 'express';
export declare class PhoneWebhooksController {
    private readonly logger;
    private assertSigned;
    voiceInbound(req: Request, body: Record<string, unknown>): string;
    voiceStatus(req: Request, body: Record<string, unknown>): string;
    smsInbound(req: Request, body: Record<string, unknown>): string;
}
