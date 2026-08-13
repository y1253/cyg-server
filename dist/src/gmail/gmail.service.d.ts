import { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { type OutboundFile } from '../communications/outbound-uploads.js';
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
type SenderFailureKind = 'scopes' | 'api_disabled';
export type SenderNamesUnavailable = SenderFailureKind | 'undisclosed';
export declare class GmailService {
    private readonly prisma;
    private readonly state;
    readonly providerKind: "GOOGLE";
    private readonly sseClients;
    private static readonly SENDER_TTL_MS;
    private static readonly SENDER_MISS_TTL_MS;
    private static readonly PEOPLE_RETRY_MS;
    private readonly senderCache;
    private readonly senderLookupWarned;
    private readonly senderFailure;
    private readonly memberListWarned;
    private readonly directoryCache;
    constructor(prisma: PrismaService, state: MessageStateService);
    generateAuthUrl(companyId: number, userId: number): {
        authUrl: string;
    };
    handleCallback(code: string, state: string): Promise<number>;
    private startWatch;
    renewExpiringWatches(): Promise<void>;
    private ensureFreshTokens;
    getAccount(companyId: number): Promise<{
        provider: "GOOGLE";
        emailAddress: string;
        gmailAddress: string;
        connectedAt: Date;
        hasChatScope: boolean;
        signatureHtml: string;
    }>;
    private buildDefaultSignature;
    getEmails(companyId: number, pageToken?: string, labelIds?: string[], q?: string): Promise<{
        messages: {
            id: string;
            threadId: string;
            subject: string;
            from: string;
            date: string;
            snippet: string;
            isRead: boolean;
            isCompleted: boolean;
            isForwarded: boolean;
            attachments: EmailAttachmentDto[];
        }[];
        nextPageToken: string | null;
    }>;
    getContacts(companyId: number): Promise<{
        email: string;
        name: string;
    }[]>;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    private resolveChatSenders;
    private notePeopleFailure;
    private notePeopleSuccess;
    private missTtl;
    private clearSenderState;
    private diagnoseSenderNames;
    private getDomainDirectory;
    getChats(companyId: number, cursor?: string, q?: string): Promise<{
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "needs_reconnect";
        senderNamesUnavailable: null;
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "no_spaces";
        senderNamesUnavailable: null;
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "app_not_configured";
        senderNamesUnavailable: null;
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "error";
        senderNamesUnavailable: null;
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: (ChatMessageDto & {
            isRead: boolean;
            isCompleted: boolean;
            hasAttachments: boolean;
        })[];
        needsReconnect: boolean;
        chatStatus: "ok";
        senderNamesUnavailable: SenderNamesUnavailable | null;
        nextCursor: string | null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "chat_disabled";
        senderNamesUnavailable: null;
        nextCursor: null;
        hasMore: boolean;
    }>;
    getChatThread(companyId: number, spaceId: string, pageToken?: string): Promise<{
        messages: never[];
        nextPageToken: null;
        needsReconnect: boolean;
        spaceName?: undefined;
        spaceType?: undefined;
    } | {
        messages: ChatMessageDto[];
        nextPageToken: string | null;
        spaceName: string;
        spaceType: string;
        needsReconnect?: undefined;
    }>;
    markChatRead(companyId: number, messageId: string): Promise<void>;
    markChatUnread(companyId: number, messageId: string): Promise<void>;
    markComplete(companyId: number, messageId: string): Promise<void>;
    markUncomplete(companyId: number, messageId: string): Promise<void>;
    private withRetry;
    private flushCompleted;
    private markExistingAsCompletedOnConnect;
    getUnreadCount(companyId: number): Promise<{
        count: number;
    }>;
    getUncompletedCount(companyId: number): Promise<{
        count: number;
    }>;
    getUncompletedCounts(): Promise<Record<number, number>>;
    private getUncompletedEmailIds;
    private computeUncompletedCount;
    private referencedCidsFromHtml;
    private parseNonInlineAttachments;
    getEmail(companyId: number, messageId: string, immutable?: boolean): Promise<{
        id: string;
        threadId: string;
        messageId: string;
        references: string;
        subject: string;
        from: string;
        to: string;
        cc: string;
        date: string;
        snippet: string;
        bodyHtml: string | null;
        bodyText: string | null;
        attachments: EmailAttachmentDto[];
        isForwarded: boolean;
        forwards: {
            to: string;
            at: string;
            messageId: string | null;
        }[];
    }>;
    getEmailThread(companyId: number, threadId: string): Promise<{
        messages: {
            id: string;
            threadId: string;
            messageId: string;
            references: string;
            subject: string;
            from: string;
            to: string;
            cc: string;
            date: string;
            snippet: string;
            bodyHtml: string | null;
            bodyText: string | null;
            attachments: EmailAttachmentDto[];
            isForwarded: boolean;
            forwards: {
                to: string;
                at: string;
                messageId: string | null;
            }[];
        }[];
    }>;
    private mapGmailMessageToDetail;
    getEmailAttachment(companyId: number, messageId: string, attachmentId: string): Promise<Buffer>;
    getChatAttachment(companyId: number, resourceName: string): Promise<Buffer>;
    transcodeAudioToMp3(input: Buffer): Promise<Buffer>;
    sendEmail(companyId: number, dto: SendEmailDto, attachments?: OutboundFile[]): Promise<void>;
    private sendEmailWithStagedFiles;
    markAsUnread(companyId: number, messageId: string): Promise<void>;
    sendChatMessage(companyId: number, dto: SendChatMessageDto): Promise<{
        id: string;
        spaceId: string;
        sender: string;
        text: string;
        createTime: string;
        lastUpdateTime: string;
        quotedMessageName: string | null;
    }>;
    private tryOpenDmSpace;
    disconnect(companyId: number): Promise<void>;
    handleWebhook(body: {
        message?: {
            data?: string;
        };
    }): Promise<void>;
    addSseClient(id: string, companyId: number, subject: Subject<{
        data: string;
    }>): void;
    removeSseClient(id: string): void;
    broadcastNewEmail(companyId: number): void;
}
export {};
