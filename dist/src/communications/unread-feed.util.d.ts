import { type UnreadFeedItemDto } from './unread-feed.types.js';
import type { ChatListResult, EmailSummaryDto } from './communications.types.js';
import type { PhoneItemDto } from '../phone/phone.types.js';
type ChatRow = ChatListResult['messages'][number];
export interface CompanyGroup {
    companyId: number;
    items: UnreadFeedItemDto[];
}
export declare function sortableIso(raw: string | null | undefined, fallbackIso: string): string;
export declare function emailToFeedItem(companyId: number, companyName: string, e: EmailSummaryDto, nowIso: string): UnreadFeedItemDto;
export declare function chatToFeedItem(companyId: number, companyName: string, m: ChatRow, nowIso: string): UnreadFeedItemDto;
export declare function phoneToFeedItem(companyId: number, companyName: string, i: PhoneItemDto, nowIso: string): UnreadFeedItemDto;
export interface InternalMessageRow {
    id: number;
    threadId: number;
    subject: string;
    snippet: string;
    date: string;
    from: {
        name: string;
    };
}
export declare function internalMessageToFeedItem(companyId: number, companyName: string, m: InternalMessageRow, nowIso: string): UnreadFeedItemDto;
export interface InternalCallRow {
    id: string;
    sid: string;
    at: string;
    outcome: 'answered' | 'missed' | 'in-progress';
    peer: {
        name: string;
    };
}
export declare function internalCallToFeedItem(companyId: number, companyName: string, c: InternalCallRow, nowIso: string): UnreadFeedItemDto;
export declare function mergeUnreadFeed(groups: CompanyGroup[], opts?: {
    perCompanyCap?: number;
    feedCap?: number;
}): {
    items: UnreadFeedItemDto[];
    truncated: boolean;
};
export {};
