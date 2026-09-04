import { PrismaService } from '../prisma/prisma.service.js';
import { AiService } from '../ai/ai.service.js';
import { SignalWireService } from './signalwire.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { type CallSummaryView } from './call-summary.util.js';
export declare class CallSummaryService {
    private readonly prisma;
    private readonly signalwire;
    private readonly timeline;
    private readonly ai;
    private readonly logger;
    private static readonly BATCH;
    private static readonly CONCURRENCY;
    private sweeping;
    constructor(prisma: PrismaService, signalwire: SignalWireService, timeline: PhoneTimelineService, ai: AiService);
    enqueue(input: {
        callSid: string;
        companyId?: number | null;
        recordingSid?: string | null;
    }): Promise<void>;
    findForCall(sid: string, parentCallSid?: string | null): Promise<CallSummaryView | null>;
    sweep(): Promise<void>;
    private runSweep;
    private process;
    private resolveRecording;
    private loadAudio;
    private finish;
    private recordFailure;
}
