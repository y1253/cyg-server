import type { Request } from 'express';
import { CallRoutingService } from './call-routing.service.js';
import { PhoneEventsService } from './phone-events.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneSettingsService } from '../phone-settings/phone-settings.service.js';
export declare class PhoneWebhooksController {
    private readonly routing;
    private readonly events;
    private readonly timeline;
    private readonly settings;
    private readonly logger;
    constructor(routing: CallRoutingService, events: PhoneEventsService, timeline: PhoneTimelineService, settings: PhoneSettingsService);
    private assertSigned;
    voiceInbound(req: Request, body: Record<string, unknown>): Promise<string>;
    private ringAndDial;
    dialStatus(req: Request, body: Record<string, string>): Promise<string>;
    voicemail(req: Request, body: Record<string, string>): Promise<string>;
    voiceStatus(req: Request, body: Record<string, unknown>): string;
    smsInbound(req: Request, body: Record<string, unknown>): string;
    private bustFor;
}
