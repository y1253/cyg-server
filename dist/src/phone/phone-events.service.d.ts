import type { Subject } from 'rxjs';
export interface IncomingCallEvent {
    type: 'incoming-call';
    companyId: number;
    companyName: string;
    from: string;
    callSid: string;
    at: number;
}
export declare class PhoneEventsService {
    private readonly logger;
    private clients;
    addClient(id: string, userId: number, subject: Subject<{
        data: string;
    }>): void;
    removeClient(id: string): void;
    isConnected(userId: number): boolean;
    broadcastIncomingCall(userIds: number[], event: IncomingCallEvent): void;
}
