import type { Request, Response } from 'express';
import { MicrosoftService } from './microsoft.service.js';
import { SendEmailDto } from '../gmail/dto/send-email.dto.js';
import { SendChatMessageDto } from '../gmail/dto/send-chat-message.dto.js';
export declare class MicrosoftController {
    private readonly microsoft;
    private readonly logger;
    constructor(microsoft: MicrosoftService);
    getAuthUrl(companyId: number, req: Request & {
        user: {
            userId: number;
        };
    }, kind?: string): Promise<{
        authUrl: string;
    }>;
    callback(code: string, state: string, res: Response): Promise<void>;
    getAccount(companyId: number): Promise<import("../communications/communications.types.js").CommunicationsAccountDto>;
    getContacts(companyId: number): Promise<{
        email: string;
        name: string;
    }[]>;
    getChats(companyId: number): Promise<import("../communications/communications.types.js").ChatListResult>;
    getChatThread(companyId: number, spaceId: string, pageToken?: string): Promise<import("../communications/communications.types.js").ChatThreadResult>;
    markChatRead(companyId: number, body: {
        messageId: string;
    }): Promise<void>;
    markChatUnread(companyId: number, body: {
        messageId: string;
    }): Promise<void>;
    markChatComplete(companyId: number, body: {
        messageId: string;
    }): Promise<void>;
    markChatUncomplete(companyId: number, body: {
        messageId: string;
    }): Promise<void>;
    getUnreadCount(companyId: number): Promise<{
        count: number;
    }>;
    getUncompletedCount(companyId: number): Promise<{
        count: number;
    }>;
    getUncompletedCounts(): Promise<Record<number, number>>;
    getEmails(companyId: number, pageToken?: string, labelIds?: string, q?: string): Promise<import("../communications/communications.types.js").EmailListResult>;
    getEmailThread(companyId: number, threadId: string): Promise<import("../communications/communications.types.js").EmailThreadResult>;
    getEmail(companyId: number, messageId: string, immutable?: string): Promise<import("../communications/communications.types.js").EmailDetailDto>;
    getEmailAttachment(companyId: number, messageId: string, attachmentId: string, token: string, mimeType: string, filename: string, disposition: string, transcode: string, range: string, res: Response): Promise<void>;
    getChatAttachment(companyId: number, token: string, resourceName: string, mimeType: string, filename: string, disposition: string, transcode: string, range: string, res: Response): Promise<void>;
    private maybeTranscode;
    markAsRead(companyId: number, messageId: string): Promise<void>;
    markAsUnread(companyId: number, messageId: string): Promise<void>;
    markEmailComplete(companyId: number, messageId: string): Promise<void>;
    markEmailUncomplete(companyId: number, messageId: string): Promise<void>;
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
}
