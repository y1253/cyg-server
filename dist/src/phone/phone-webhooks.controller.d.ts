import type { Request } from 'express';
import { CallRoutingService } from './call-routing.service.js';
import { PhoneEventsService } from './phone-events.service.js';
export declare class PhoneWebhooksController {
    private readonly routing;
    private readonly events;
    private readonly logger;
    constructor(routing: CallRoutingService, events: PhoneEventsService);
    private assertSigned;
    voiceInbound(req: Request, body: Record<string, unknown>): Promise<string>;
    voiceStatus(req: Request, body: Record<string, unknown>): string;
    smsInbound(req: Request, body: Record<string, unknown>): string;
}
