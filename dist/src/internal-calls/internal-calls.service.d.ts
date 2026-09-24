import { type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from '../phone/signalwire.service.js';
import { PhoneEventsService } from '../phone/phone-events.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { CallControlService } from '../phone/call-control.service.js';
import { ConferenceService } from '../phone/conference.service.js';
import { CallSummaryService } from '../phone/call-summary.service.js';
import type { CallSummaryView } from '../phone/call-summary.util.js';
export type InternalCallFolder = 'INBOX' | 'UNCOMPLETED' | 'UNREAD' | 'SENT';
export declare const INTERNAL_CALL_FOLDERS: InternalCallFolder[];
export declare const INTERNAL_CALL_ID_PREFIX = "intcall:";
export declare const internalCallItemId: (sid: string) => string;
export interface InternalCallView {
    id: string;
    sid: string;
    direction: 'inbound' | 'outbound';
    peer: {
        id: number;
        name: string;
    };
    at: string;
    durationSec: number | null;
    status: string | null;
    outcome: 'answered' | 'missed' | 'in-progress';
    isRead: boolean;
    isCompleted: boolean;
    hasRecording: boolean;
    summaryLine: string | null;
}
export interface InternalCallListResult {
    calls: InternalCallView[];
    nextCursor: number | null;
}
export type InternalCallStateAction = 'read' | 'unread' | 'complete' | 'uncomplete';
export interface InternalRecordingView {
    sid: string;
    durationSec: number;
    createdAt: string | null;
    token: string;
}
export declare class InternalCallsService implements OnModuleInit, OnModuleDestroy {
    private readonly prisma;
    private readonly signalwire;
    private readonly events;
    private readonly summaries;
    private readonly callControl;
    private readonly conference;
    private readonly realtime;
    private readonly logger;
    private subs;
    private static readonly RING_TIMEOUT;
    private static readonly CHILD_LEG_GRACE_MS;
    private static readonly ROW_RACE_RETRY_MS;
    private static readonly MAX_RING_MS;
    private static readonly STUCK_RING_MAX_AGE_MS;
    private sweeping;
    constructor(prisma: PrismaService, signalwire: SignalWireService, events: PhoneEventsService, summaries: CallSummaryService, callControl: CallControlService, conference: ConferenceService, realtime: RealtimeService);
    onModuleInit(): void;
    onModuleDestroy(): void;
    sweepStuckRings(): Promise<void>;
    private isSettled;
    private isAnsweredOutcome;
    private writableWhen;
    private isFinal;
    private settleFromDial;
    private dialDuration;
    private settleNow;
    reportEnded(userId: number, callSid: string, input: {
        answered: boolean;
        durationSec: number;
    }): Promise<void>;
    private writeOutcome;
    startCall(callerId: number, calleeId: number): Promise<{
        callSid: string;
        peer: {
            id: number;
            name: string;
        };
    }>;
    private folderWhere;
    list(userId: number, folder?: InternalCallFolder, cursor?: number, limit?: number): Promise<InternalCallListResult>;
    private recordedCache;
    private recordedInFlight;
    private static readonly RECORDED_TTL_MS;
    private recordedSids;
    counts(userId: number): Promise<{
        unread: number;
        uncompleted: number;
        missedUnread: number;
    }>;
    private static readonly MISSED_COUNT_SCAN;
    private static readonly MISSED_BACKFILL_WINDOW_MS;
    setState(userId: number, callSid: string, action: InternalCallStateAction): Promise<void>;
    recordings(userId: number, callSid: string): Promise<{
        recordings: InternalRecordingView[];
        summary: CallSummaryView | null;
    }>;
    private backfillPending;
    private settleOne;
    private childLegsOf;
    hangUp(userId: number, callSid: string): Promise<{
        ended: string[];
    }>;
    transferBlind(userId: number, callSid: string, targetUserId: number): Promise<{
        transferredSid: string;
    }>;
    transferStatus(userId: number, callSid: string): Promise<{
        state: import("../phone/call-legs.util.js").TransferState;
        targetName: string | null;
    }>;
    private conferenceContext;
    conferenceAdd(userId: number, callSid: string, targetUserId: number): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceHold(userId: number, callSid: string, partyId: string, held: boolean): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceSwap(userId: number, callSid: string): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceMerge(userId: number, callSid: string): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceDrop(userId: number, callSid: string, partyId: string): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    conferenceStatus(userId: number, callSid: string): Promise<import("../phone/call-legs.util.js").ConferenceView>;
    private assertParticipant;
    private outcomeOf;
}
