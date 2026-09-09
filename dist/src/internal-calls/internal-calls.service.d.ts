import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from '../phone/signalwire.service.js';
import { PhoneEventsService } from '../phone/phone-events.service.js';
import { CallControlService } from '../phone/call-control.service.js';
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
export declare class InternalCallsService {
    private readonly prisma;
    private readonly signalwire;
    private readonly events;
    private readonly summaries;
    private readonly callControl;
    private readonly logger;
    private static readonly RING_TIMEOUT;
    constructor(prisma: PrismaService, signalwire: SignalWireService, events: PhoneEventsService, summaries: CallSummaryService, callControl: CallControlService);
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
    }>;
    setState(userId: number, callSid: string, action: InternalCallStateAction): Promise<void>;
    recordings(userId: number, callSid: string): Promise<{
        recordings: InternalRecordingView[];
        summary: CallSummaryView | null;
    }>;
    private backfillPending;
    transferBlind(userId: number, callSid: string, targetUserId: number): Promise<{
        transferredSid: string;
    }>;
    transferStatus(userId: number, callSid: string): Promise<{
        state: import("../phone/call-legs.util.js").TransferState;
        targetName: string | null;
    }>;
    private assertParticipant;
    private outcomeOf;
}
