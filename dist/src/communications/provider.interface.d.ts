import type { ChatListResult, ChatThreadResult, CommunicationsAccountDto, CommunicationsProviderKind, DraftDetailDto, DraftRefDto, EmailDetailDto, EmailListResult, EmailThreadResult, LatestPreviewDto } from './communications.types.js';
import type { SaveDraftDto } from '../gmail/dto/save-draft.dto.js';
import type { OutboundFile } from './outbound-uploads.js';
export interface CommunicationsProvider {
    readonly providerKind: CommunicationsProviderKind;
    getAccount(companyId: number): Promise<CommunicationsAccountDto | null>;
    disconnect(companyId: number): Promise<void>;
    getEmails(companyId: number, pageToken?: string, labelIds?: string[], q?: string): Promise<EmailListResult>;
    getEmail(companyId: number, messageId: string, immutable?: boolean): Promise<EmailDetailDto>;
    getEmailThread(companyId: number, threadId: string): Promise<EmailThreadResult>;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    markAsUnread(companyId: number, messageId: string): Promise<void>;
    createDraft(companyId: number, dto: SaveDraftDto, attachments: OutboundFile[]): Promise<DraftRefDto>;
    updateDraft(companyId: number, draftId: string, dto: SaveDraftDto): Promise<DraftRefDto>;
    getDraft(companyId: number, draftId: string): Promise<DraftDetailDto>;
    deleteDraft(companyId: number, draftId: string): Promise<void>;
    sendDraft(companyId: number, draftId: string): Promise<unknown>;
    getChats(companyId: number, cursor?: string, q?: string): Promise<ChatListResult>;
    getChatThread(companyId: number, spaceId: string, pageToken?: string): Promise<ChatThreadResult>;
    markChatRead(companyId: number, messageId: string): Promise<void>;
    markChatUnread(companyId: number, messageId: string): Promise<void>;
    markComplete(companyId: number, messageId: string): Promise<void>;
    markUncomplete(companyId: number, messageId: string): Promise<void>;
    getLatestPreview(companyId: number): Promise<LatestPreviewDto | null>;
    getUnreadCount(companyId: number): Promise<{
        count: number;
    }>;
    getUncompletedCount(companyId: number): Promise<{
        count: number;
    }>;
    getUncompletedCounts(): Promise<Record<number, number>>;
}
