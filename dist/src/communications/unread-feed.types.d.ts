export declare const PER_COMPANY_CAP = 10;
export declare const FEED_CAP = 50;
interface FeedItemBase {
    id: string;
    companyId: number;
    companyName: string;
    from: string;
    title: string;
    snippet: string;
    at: string;
}
export type UnreadFeedItemDto = (FeedItemBase & {
    scope: 'company';
    kind: 'email';
    msgId: string;
    threadId: string | null;
}) | (FeedItemBase & {
    scope: 'company';
    kind: 'chat';
    spaceId: string;
    msgId: string;
    msgTime: string;
}) | (FeedItemBase & {
    scope: 'company';
    kind: 'sms';
    peer: string;
    msgId: string;
    msgTime: string;
}) | (FeedItemBase & {
    scope: 'company';
    kind: 'call';
    sid: string;
    itemId: string;
    isVoicemail: boolean;
}) | (FeedItemBase & {
    scope: 'internal';
    kind: 'message';
    messageId: number;
    threadId: number;
}) | (FeedItemBase & {
    scope: 'internal';
    kind: 'call';
    sid: string;
});
export interface UnreadFeedFailure {
    companyId: number;
    companyName: string;
}
export interface UnreadFeedResult {
    items: UnreadFeedItemDto[];
    truncated: boolean;
    failed: UnreadFeedFailure[];
}
export interface InboxSummaryDto {
    uncompleted: Record<number, number>;
    unread: UnreadFeedItemDto[];
    truncated: boolean;
    failed: UnreadFeedFailure[];
}
export {};
