import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from './signalwire.service.js';
import { PhoneEventsService } from './phone-events.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
export declare class PhoneDialerService {
    private readonly prisma;
    private readonly signalwire;
    private readonly events;
    private readonly timeline;
    private readonly logger;
    constructor(prisma: PrismaService, signalwire: SignalWireService, events: PhoneEventsService, timeline: PhoneTimelineService);
    private static readonly RING_TIMEOUT;
    startCall(companyId: number, to: string, userId: number): Promise<{
        callSid: string;
        to: string;
        companyName: string;
    }>;
    private assertMayDial;
}
