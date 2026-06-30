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
    isOwn?: boolean;
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
    getEmails(companyId: number, pageToken?: string, labelIds?: string[]): Promise<{
        messages: {
            id: string;
            subject: string;
            from: string;
            date: string;
            snippet: string;
            isRead: boolean;
        }[];
        nextPageToken: string | null;
    }>;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    getChats(companyId: number): Promise<{
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "needs_reconnect";
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "no_spaces";
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "app_not_configured";
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "error";
    } | {
        messages: (ChatMessageDto & {
            isRead: boolean;
        })[];
        needsReconnect: boolean;
        chatStatus: "ok";
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "chat_disabled";
    }>;
    getChatThread(companyId: number, spaceId: string, pageToken?: string, untilCreateTime?: string): Promise<{
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
    }>;
    sendEmail(companyId: number, dto: SendEmailDto): Promise<void>;
    markAsUnread(companyId: number, messageId: string): Promise<void>;
    sendChatMessage(companyId: number, dto: SendChatMessageDto): Promise<{
        id: string;
        spaceId: string;
        sender: string;
        text: string;
        createTime: string;
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
