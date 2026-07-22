export type CommunicationsProviderKind = 'GOOGLE' | 'MICROSOFT';
export interface ChatMessageDto {
    id: string;
    spaceId: string;
    spaceName: string;
    spaceType: string;
    sender: string;
    text: string;
    createTime: string;
    lastUpdateTime: string;
    quotedMessageName?: string | null;
    isOwn?: boolean;
    attachments?: ChatAttachmentDto[];
}
export interface EmailAttachmentDto {
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
    contentId: string | null;
    isInline: boolean;
}
export interface ChatAttachmentDto {
    name: string;
    contentName: string;
    contentType: string;
    resourceName: string | null;
    driveFileId: string | null;
    thumbnailUri: string | null;
    downloadUri: string | null;
    source: string | null;
}
export type SenderNamesUnavailable = 'scopes' | 'api_disabled' | 'undisclosed';
export type ChatStatus = 'ok' | 'needs_reconnect' | 'no_spaces' | 'app_not_configured' | 'chat_disabled' | 'error';
export interface ChatListResult {
    messages: (ChatMessageDto & {
        isRead: boolean;
        isCompleted: boolean;
        hasAttachments: boolean;
    })[];
    needsReconnect: boolean;
    chatStatus: ChatStatus;
    senderNamesUnavailable: SenderNamesUnavailable | null;
    nextCursor: string | null;
    hasMore: boolean;
}
export interface ChatThreadResult {
    messages: ChatMessageDto[];
    nextPageToken: string | null;
    spaceName?: string;
    spaceType?: string;
    needsReconnect?: boolean;
}
export interface EmailSummaryDto {
    id: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
    isRead: boolean;
    isCompleted: boolean;
    isForwarded: boolean;
    attachments: EmailAttachmentDto[];
}
export interface EmailListResult {
    messages: EmailSummaryDto[];
    nextPageToken: string | null;
}
export interface EmailDetailDto {
    id: string;
    threadId: string;
    messageId: string;
    subject: string;
    from: string;
    to: string;
    date: string;
    snippet: string;
    bodyHtml: string | null;
    bodyText: string | null;
    attachments: EmailAttachmentDto[];
    isRead?: boolean;
    isCompleted?: boolean;
    isForwarded: boolean;
    forwards: {
        to: string;
        at: string;
    }[];
}
export interface CommunicationsAccountDto {
    provider: CommunicationsProviderKind;
    emailAddress: string;
    gmailAddress: string;
    connectedAt: string | Date;
    hasChatScope: boolean;
    signatureHtml: string;
}
