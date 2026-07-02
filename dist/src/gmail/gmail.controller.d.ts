import { MessageEvent } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request, Response } from 'express';
import { GmailService } from './gmail.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';
export declare class GmailController {
    private readonly gmailService;
    constructor(gmailService: GmailService);
    getAuthUrl(companyId: number, req: Request & {
        user: {
            userId: number;
        };
    }): {
        authUrl: string;
    };
    callback(code: string, state: string, res: Response): Promise<void>;
    getAccount(companyId: number): Promise<{
        gmailAddress: string;
        connectedAt: Date;
        hasChatScope: boolean;
    }>;
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
        messages: (import("./gmail.service.js").ChatMessageDto & {
            isRead: boolean;
            hasAttachments: boolean;
        })[];
        needsReconnect: boolean;
        chatStatus: "ok";
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "chat_disabled";
    }>;
    getChatThread(companyId: number, spaceId: string, pageToken?: string): Promise<{
        messages: never[];
        nextPageToken: null;
        needsReconnect: boolean;
        spaceName?: undefined;
        spaceType?: undefined;
    } | {
        messages: import("./gmail.service.js").ChatMessageDto[];
        nextPageToken: string | null;
        spaceName: string;
        spaceType: string;
        needsReconnect?: undefined;
    }>;
    markChatRead(companyId: number, body: {
        messageId: string;
    }): Promise<void>;
    markChatUnread(companyId: number, body: {
        messageId: string;
    }): Promise<void>;
    getUnreadCount(companyId: number): Promise<{
        count: number;
    }>;
    getEmails(companyId: number, pageToken?: string, labelIds?: string): Promise<{
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
        attachments: import("./gmail.service.js").EmailAttachmentDto[];
    }>;
    getEmailAttachment(companyId: number, messageId: string, attachmentId: string, token: string, mimeType: string, filename: string, disposition: string, transcode: string, range: string, res: Response): Promise<void>;
    getChatAttachment(companyId: number, token: string, resourceName: string, mimeType: string, filename: string, disposition: string, transcode: string, range: string, res: Response): Promise<void>;
    private maybeTranscode;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    markAsUnread(companyId: number, messageId: string): Promise<void>;
    sendEmail(companyId: number, dto: SendEmailDto, attachments?: Array<{
        originalname: string;
        mimetype: string;
        buffer: Buffer;
        size: number;
    }>): Promise<void>;
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
    }): void;
    streamEvents(companyId: number, token: string, req: Request): Observable<MessageEvent>;
}
