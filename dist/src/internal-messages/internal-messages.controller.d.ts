import type { Request as ExpressRequest, Response } from 'express';
import { Observable } from 'rxjs';
import { SendInternalMessageDto } from './dto/send-internal-message.dto.js';
import { InternalMessagesService, UploadedAttachment } from './internal-messages.service.js';
type AuthedRequest = {
    user: {
        userId: number;
        role: string;
    };
};
interface MessageEvent {
    data: string;
}
export declare class InternalMessagesController {
    private readonly service;
    constructor(service: InternalMessagesService);
    list(req: AuthedRequest, folder?: string, cursor?: string, q?: string): Promise<{
        messages: ReturnType<InternalMessagesService["toSummary"]>[];
        nextCursor: number | null;
    }>;
    uncompletedCount(req: AuthedRequest): Promise<{
        count: number;
    }>;
    unreadCount(req: AuthedRequest): Promise<{
        count: number;
    }>;
    thread(req: AuthedRequest, threadId?: string): Promise<{
        messages: {
            bodyHtml: string | null;
            bodyText: string | null;
            id: number;
            threadId: number;
            parentId: number | null;
            subject: string;
            date: string;
            snippet: string;
            isOwn: boolean;
            isForward: boolean;
            isRead: boolean;
            isCompleted: boolean;
            from: {
                name: string;
                id: number;
                email: string;
            };
            to: {
                name: string;
                id: number;
                email: string;
            }[];
            cc: {
                name: string;
                id: number;
                email: string;
            }[];
            attachments: {
                id: number;
                filename: string;
                mimeType: string;
                size: number;
            }[];
        }[];
    }>;
    attachment(id: number, token: string, disposition: string, req: ExpressRequest, res: Response): Promise<void>;
    send(req: AuthedRequest, dto: SendInternalMessageDto, files: UploadedAttachment[] | undefined): Promise<{
        bodyHtml: string | null;
        bodyText: string | null;
        id: number;
        threadId: number;
        parentId: number | null;
        subject: string;
        date: string;
        snippet: string;
        isOwn: boolean;
        isForward: boolean;
        isRead: boolean;
        isCompleted: boolean;
        from: {
            name: string;
            id: number;
            email: string;
        };
        to: {
            name: string;
            id: number;
            email: string;
        }[];
        cc: {
            name: string;
            id: number;
            email: string;
        }[];
        attachments: {
            id: number;
            filename: string;
            mimeType: string;
            size: number;
        }[];
    }>;
    streamEvents(token: string, req: ExpressRequest): Observable<MessageEvent>;
    getOne(id: number, req: AuthedRequest): Promise<{
        bodyHtml: string | null;
        bodyText: string | null;
        id: number;
        threadId: number;
        parentId: number | null;
        subject: string;
        date: string;
        snippet: string;
        isOwn: boolean;
        isForward: boolean;
        isRead: boolean;
        isCompleted: boolean;
        from: {
            name: string;
            id: number;
            email: string;
        };
        to: {
            name: string;
            id: number;
            email: string;
        }[];
        cc: {
            name: string;
            id: number;
            email: string;
        }[];
        attachments: {
            id: number;
            filename: string;
            mimeType: string;
            size: number;
        }[];
    }>;
    markRead(id: number, req: AuthedRequest): Promise<void>;
    markUnread(id: number, req: AuthedRequest): Promise<void>;
    markComplete(id: number, req: AuthedRequest): Promise<void>;
    markUncomplete(id: number, req: AuthedRequest): Promise<void>;
}
export {};
