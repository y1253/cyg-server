export type RealtimeTopic = 'call-ended' | 'phone' | 'phone-state' | 'active-call' | 'ringing' | 'sms' | 'whatsapp' | 'email' | 'internal-message' | 'internal-call' | 'presence';
export interface RealtimeEvent {
    seq: number;
    at: number;
    topic: RealtimeTopic;
    companyId?: number;
    userIds?: number[];
    payload?: unknown;
}
export interface RealtimePublishOptions {
    companyId?: number;
    userIds?: number[];
    payload?: unknown;
}
export interface RealtimeBatch {
    seq: number;
    events: RealtimeEvent[];
    reset?: boolean;
}
