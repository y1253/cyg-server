import { PrismaService } from '../prisma/prisma.service.js';
import { SmsOptOutService } from './sms-opt-out.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { type SwCall, type SwRecording } from './signalwire-parse.js';
export interface StagedMms {
    path: string;
    filename: string;
    mimetype: string;
    size: number;
    derived: string[];
}
import type { PhoneCountsDto, PhoneItemDto, PhoneTimelineResult, RecordingDto, SmsItemDto, SmsThreadResult } from './phone.types.js';
export declare class PhoneTimelineService {
    private readonly prisma;
    private readonly signalwire;
    private readonly state;
    private readonly optOuts;
    private readonly logger;
    constructor(prisma: PrismaService, signalwire: SignalWireService, state: MessageStateService, optOuts: SmsOptOutService);
    private static readonly TTL_MS;
    private static readonly HISTORIC_TTL_MS;
    private static readonly MAX_ENTRIES;
    private static readonly COUNT_WINDOW_MS;
    private static readonly SMS_MEDIA_CONCURRENCY;
    private cache;
    private inFlight;
    bust(companyId: number): void;
    private activeNumber;
    private loadWindow;
    private evictStale;
    private contactNamesFor;
    private itemsFor;
    getTimeline(companyId: number, beforeIso?: string, limit?: number): Promise<PhoneTimelineResult>;
    getCounts(companyId: number): Promise<PhoneCountsDto>;
    getUnreadItems(companyId: number, limit: number): Promise<PhoneItemDto[]>;
    private countsAll;
    private countsAllInFlight;
    private static readonly COUNTS_ALL_TTL_MS;
    private static readonly COUNTS_ALL_CONCURRENCY;
    getUncompletedCountsForAll(): Promise<Record<number, number>>;
    getMissedUnreadCountsForAll(): Promise<Record<number, number>>;
    refreshCompanyCounts(companyId: number): Promise<void>;
    private getCountsForAll;
    private sweepCounts;
    getSmsThread(companyId: number, peer: string, limit?: number): Promise<SmsThreadResult>;
    private withMedia;
    sendSms(companyId: number, to: string, body: string, files?: StagedMms[]): Promise<SmsItemDto>;
    private publishMms;
    private fitForMms;
    private writeStagedMms;
    findRecordingsForCall(callSid: string, knownCall?: SwCall | null): Promise<{
        recordings: SwRecording[];
        onSid: string;
    }>;
    getCallRecordings(companyId: number, callSid: string): Promise<RecordingDto[]>;
    assertCallBelongsTo(companyId: number, callSid: string): Promise<SwCall>;
    assertCallBelongsToNumber(companyId: number, callSid: string): Promise<{
        call: SwCall;
        supportNumber: string;
    }>;
    rowItemIdForCall(call: SwCall, supportNumber: string): Promise<string | null>;
}
