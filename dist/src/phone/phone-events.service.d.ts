import type { Subject } from 'rxjs';
export interface CallEvent {
    type: 'incoming-call' | 'outgoing-call';
    direction: 'inbound' | 'outbound';
    companyId: number;
    companyName: string;
    from: string;
    to?: string;
    callSid: string;
    at: number;
    token?: string;
}
export type IncomingCallEvent = CallEvent;
export declare class PhoneEventsService {
    private readonly logger;
    private clients;
    private pending;
    private ringingByCompany;
    private static readonly RINGING_TTL_MS;
    private static readonly PENDING_TTL_MS;
    takePending(userId: number): CallEvent | null;
    getRinging(companyId: number): CallEvent | null;
    clearRinging(callSid: string): void;
    addClient(id: string, userId: number, subject: Subject<{
        data: string;
    }>): void;
    removeClient(id: string): void;
    isConnected(userId: number): boolean;
    broadcastIncomingCall(userIds: number[], event: CallEvent): void;
    broadcastOutgoingCall(userId: number, event: CallEvent): void;
}
