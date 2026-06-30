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
        })[];
        needsReconnect: boolean;
        chatStatus: "ok";
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "chat_disabled";
    }>;
    getChatThread(companyId: number, spaceId: string, pageToken?: string, until?: string): Promise<{
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
    }>;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    markAsUnread(companyId: number, messageId: string): Promise<void>;
    sendEmail(companyId: number, dto: SendEmailDto): Promise<void>;
    sendChatMessage(companyId: number, dto: SendChatMessageDto): Promise<void>;
    disconnect(companyId: number): Promise<void>;
    handleWebhook(body: {
        message?: {
            data?: string;
        };
    }): void;
    streamEvents(companyId: number, token: string, req: Request): Observable<MessageEvent>;
}
