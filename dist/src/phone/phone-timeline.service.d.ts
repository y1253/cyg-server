import { PrismaService } from '../prisma/prisma.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import type { PhoneTimelineResult, RecordingDto, SmsItemDto, SmsThreadResult } from './phone.types.js';
export declare class PhoneTimelineService {
    private readonly prisma;
    private readonly signalwire;
    private readonly state;
    private readonly logger;
    constructor(prisma: PrismaService, signalwire: SignalWireService, state: MessageStateService);
    private static readonly TTL_MS;
    private static readonly HISTORIC_TTL_MS;
    private static readonly MAX_ENTRIES;
    private static readonly COUNT_WINDOW_MS;
    private cache;
    private inFlight;
    bust(companyId: number): void;
    private activeNumber;
    private loadWindow;
    private evictStale;
    private itemsFor;
    getTimeline(companyId: number, beforeIso?: string, limit?: number): Promise<PhoneTimelineResult>;
    getCounts(companyId: number): Promise<{
        unread: number;
        uncompleted: number;
    }>;
    getSmsThread(companyId: number, peer: string, limit?: number): Promise<SmsThreadResult>;
    sendSms(companyId: number, to: string, body: string): Promise<SmsItemDto>;
    getCallRecordings(companyId: number, callSid: string): Promise<RecordingDto[]>;
    private assertCallBelongsTo;
}
