export type PhoneItemKind = 'call' | 'sms';
interface PhoneItemBase {
    id: string;
    sid: string;
    kind: PhoneItemKind;
    direction: 'inbound' | 'outbound';
    counterparty: string;
    counterpartyName?: string | null;
    supportNumber: string;
    at: string;
    isRead: boolean;
    isCompleted: boolean;
}
export interface PhoneCountsDto {
    unread: number;
    uncompleted: number;
    missedUnread: number;
}
export interface PhoneCountsMapsDto {
    uncompleted: Record<number, number>;
    missedUnread: Record<number, number>;
}
export type CallOutcome = 'answered' | 'missed' | 'failed' | 'in-progress';
export interface CallItemDto extends PhoneItemBase {
    kind: 'call';
    status: string;
    outcome: CallOutcome;
    durationSec: number;
    hasRecording: boolean;
    hasVoicemail: boolean;
    parentCallSid: string | null;
}
export interface SmsMediaDto {
    sid: string;
    contentType: string;
    token: string;
}
export interface SmsItemDto extends PhoneItemBase {
    kind: 'sms';
    body: string;
    numMedia: number;
    status: string;
    errorCode: number | null;
    media?: SmsMediaDto[];
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
