import { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';
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
export declare class GmailService {
    private readonly prisma;
    private readonly sseClients;
    constructor(prisma: PrismaService);
    generateAuthUrl(companyId: number, userId: number): {
        authUrl: string;
    };
    handleCallback(code: string, state: string): Promise<number>;
    private startWatch;
    renewExpiringWatches(): Promise<void>;
    private ensureFreshTokens;
    getAccount(companyId: number): Promise<{
        gmailAddress: string;
        connectedAt: Date;
        hasChatScope: boolean;
    }>;
    getEmails(companyId: number, pageToken?: string, labelIds?: string[], q?: string): Promise<{
        messages: {
            id: string;
            subject: string;
            from: string;
            date: string;
            snippet: string;
            isRead: boolean;
            isCompleted: boolean;
        }[];
        nextPageToken: string | null;
    }>;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    getChats(companyId: number, cursor?: string, q?: string): Promise<{
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "needs_reconnect";
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "no_spaces";
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "app_not_configured";
        nextCursor: null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "error";
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
        nextCursor: string | null;
        hasMore: boolean;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "chat_disabled";
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
    getUnreadCount(companyId: number): Promise<{
        count: number;
    }>;
    getEmail(companyId: number, messageId: string): Promise<{
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
    }>;
    getEmailAttachment(companyId: number, messageId: string, attachmentId: string): Promise<Buffer>;
    getChatAttachment(companyId: number, resourceName: string): Promise<Buffer>;
    transcodeAudioToMp3(input: Buffer): Promise<Buffer>;
    sendEmail(companyId: number, dto: SendEmailDto, attachments?: Array<{
        originalname: string;
        mimetype: string;
        buffer: Buffer;
    }>): Promise<void>;
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
