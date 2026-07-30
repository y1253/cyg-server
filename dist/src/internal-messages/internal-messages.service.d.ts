import type { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
export type Folder = 'INBOX' | 'UNCOMPLETED' | 'UNREAD' | 'SENT';
export interface UploadedAttachment {
    originalname: string;
    mimetype: string;
    size: number;
    filename: string;
    path: string;
}
export interface ForwardRecord {
    messageId: number;
    at: string;
    to: string;
    by: {
        id: number;
        name: string;
    };
}
export declare class InternalMessagesService {
    private prisma;
    constructor(prisma: PrismaService);
    private sseClients;
    private snippet;
    private toSummary;
    private toDetail;
    private loadForwards;
    private visibleToViewer;
    private loadVisible;
    private folderWhere;
    list(viewerId: number, folder: Folder, cursor?: number, q?: string): Promise<{
        messages: ReturnType<InternalMessagesService['toSummary']>[];
        nextCursor: number | null;
    }>;
    getOne(id: number, viewerId: number): Promise<{
        bodyHtml: string | null;
        bodyText: string | null;
        isForwarded: boolean;
        forwards: ForwardRecord[];
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
    getThread(threadId: number, viewerId: number): Promise<{
        messages: {
            bodyHtml: string | null;
            bodyText: string | null;
            isForwarded: boolean;
            forwards: ForwardRecord[];
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
    getUncompletedCount(viewerId: number): Promise<number>;
    getUnreadCount(viewerId: number): Promise<number>;
    private setState;
    markRead(id: number, viewerId: number): Promise<void>;
    markUnread(id: number, viewerId: number): Promise<void>;
    markComplete(id: number, viewerId: number): Promise<void>;
    markUncomplete(id: number, viewerId: number): Promise<void>;
    send(senderId: number, input: {
        to: number[];
        cc: number[];
        subject?: string;
        body: string;
        bodyHtml?: string;
        parentId?: number;
        isForward?: boolean;
    }, files: UploadedAttachment[]): Promise<{
        bodyHtml: string | null;
        bodyText: string | null;
        isForwarded: boolean;
        forwards: ForwardRecord[];
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
    private discardFiles;
    getAttachment(attachmentId: number, viewerId: number): Promise<{
        absolutePath: string;
        id: number;
        createdAt: Date;
        messageId: number;
        filename: string;
        mimeType: string;
        size: number;
        storagePath: string;
    }>;
    addSseClient(id: string, userId: number, subject: Subject<{
        data: string;
    }>): void;
    removeSseClient(id: string): void;
    broadcastNewMessage(userId: number): void;
}
