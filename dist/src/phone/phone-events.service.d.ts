import { Subject } from 'rxjs';
export interface InboundSms {
    to: string;
    from: string;
    body: string;
}
export interface DialCompleted {
    callSid: string;
    dialCallSid: string | null;
    dialStatus: string;
    durationSec: number | null;
    to: string;
}
export interface CallEnded {
    callSid: string;
    companyId: number | null;
    status: string;
}
export interface InboundVoiceCode {
    to: string;
    from: string;
    callSid: string;
    recordingSid: string | null;
    startedAt: number;
}
export interface CallEvent {
    type: 'incoming-call' | 'outgoing-call';
    direction: 'inbound' | 'outbound';
    companyId: number;
    companyName: string;
    from: string;
    fromName?: string;
    to?: string;
    callSid: string;
    at: number;
    quickReplies?: string[];
    token?: string;
    transferFrom?: {
        id: number;
        name: string;
    };
    kind?: 'company' | 'internal';
}
export type IncomingCallEvent = CallEvent;
export declare class PhoneEventsService {
    private readonly logger;
    readonly smsReceived$: Subject<InboundSms>;
    emitSms(sms: InboundSms): void;
    readonly dialCompleted$: Subject<DialCompleted>;
    emitDialCompleted(e: DialCompleted): void;
    readonly callEnded$: Subject<CallEnded>;
    emitCallEnded(e: CallEnded): void;
    private static readonly MAX_VOICE_CODE_CALLS;
    private voiceCodeExpectations;
    expectVoiceCode(e164: string, ttlMs: number): void;
    clearVoiceCode(e164: string): void;
    takeVoiceCodeExpectation(e164: string): {
        requestedAt: number;
    } | null;
    readonly voiceCodeRecorded$: Subject<InboundVoiceCode>;
    emitVoiceCode(event: InboundVoiceCode): void;
    private clients;
    private pending;
    private ringingByCompany;
    private static readonly RINGING_TTL_MS;
    private static readonly PENDING_TTL_MS;
    private static readonly MAX_EVENTS_PER_KEY;
    takeAllPending(userId: number): CallEvent[];
    takePending(userId: number): CallEvent | null;
    private livePending;
    clearPendingFor(userId: number, callSid?: string): void;
    getRinging(companyId: number, viewerId?: number): CallEvent | null;
    private liveRinging;
    private withEvent;
    clearRinging(callSid: string): void;
    addClient(id: string, userId: number, subject: Subject<{
        data: string;
    }>): void;
    removeClient(id: string): void;
    isConnected(userId: number): boolean;
    private static readonly HEARTBEAT_TTL_MS;
    private heartbeats;
    noteHeartbeat(userId: number, busy: boolean): void;
    private liveHeartbeats;
    presenceFor(userIds: number[]): {
        userIds: number[];
        busyUserIds: number[];
    };
    broadcastIncomingCall(userIds: number[], event: CallEvent, opts?: {
        publishToCompany?: boolean;
    }): void;
    broadcastOutgoingCall(userId: number, event: CallEvent): void;
}
