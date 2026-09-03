export type PhoneItemKind = 'call' | 'sms';
interface PhoneItemBase {
    id: string;
    sid: string;
    kind: PhoneItemKind;
    direction: 'inbound' | 'outbound';
    counterparty: string;
    supportNumber: string;
    at: string;
    isRead: boolean;
    isCompleted: boolean;
}
export interface CallItemDto extends PhoneItemBase {
    kind: 'call';
    status: string;
    outcome: 'answered' | 'missed' | 'failed' | 'in-progress';
    durationSec: number;
    hasRecording: boolean;
    hasVoicemail: boolean;
    parentCallSid: string | null;
}
export interface SmsItemDto extends PhoneItemBase {
    kind: 'sms';
    body: string;
    numMedia: number;
    status: string;
    errorCode: number | null;
}
export type PhoneItemDto = CallItemDto | SmsItemDto;
export interface PhoneTimelineResult {
    items: PhoneItemDto[];
    nextCursor: string | null;
    hasMore: boolean;
    hasNumber: boolean;
    supportNumber: string | null;
}
export interface RecordingDto {
    sid: string;
    durationSec: number;
    createdAt: string | null;
    token: string;
}
export interface SmsThreadResult {
    messages: SmsItemDto[];
    peer: string;
    supportNumber: string | null;
}
export {};
