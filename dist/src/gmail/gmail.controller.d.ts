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
        errorDetail?: undefined;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "no_spaces";
        errorDetail?: undefined;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "error";
        errorDetail: string;
    } | {
        messages: {
            id: string;
            spaceId: string;
            spaceName: string;
            sender: string;
            text: string;
            createTime: string;
        }[];
        needsReconnect: boolean;
        chatStatus: "ok";
        errorDetail?: undefined;
    } | {
        messages: never[];
        needsReconnect: boolean;
        chatStatus: "chat_disabled";
        errorDetail?: undefined;
    }>;
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
