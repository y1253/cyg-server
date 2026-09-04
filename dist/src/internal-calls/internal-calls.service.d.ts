import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from '../phone/signalwire.service.js';
import { PhoneEventsService } from '../phone/phone-events.service.js';
import { CallSummaryService } from '../phone/call-summary.service.js';
import type { CallSummaryView } from '../phone/call-summary.util.js';
export interface InternalCallView {
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
}
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
    private readonly logger;
    private static readonly RING_TIMEOUT;
    constructor(prisma: PrismaService, signalwire: SignalWireService, events: PhoneEventsService, summaries: CallSummaryService);
    startCall(callerId: number, calleeId: number): Promise<{
        callSid: string;
        peer: {
            id: number;
            name: string;
        };
    }>;
    list(userId: number, limit?: number): Promise<InternalCallView[]>;
    recordings(userId: number, callSid: string): Promise<{
        recordings: InternalRecordingView[];
        summary: CallSummaryView | null;
    }>;
    private backfillPending;
    private assertParticipant;
    private outcomeOf;
}
