import type { Subject } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { type EmailSearchFilters } from '../communications/email-search.js';
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
export interface NewMessageMeta {
    from: string;
    subject: string;
    snippet: string;
    threadId: number;
}
export declare class InternalMessagesService {
    private prisma;
    private storage;
    private realtime;
    constructor(prisma: PrismaService, storage: ObjectStorageService, realtime: RealtimeService);
    private sseClients;
    private snippet;
    private toSummary;
    private toDetail;
    private loadForwards;
    private visibleToViewer;
    private loadVisible;
    private folderWhere;
    private searchClauses;
    list(viewerId: number, folder: Folder, cursor?: number, q?: string, filters?: EmailSearchFilters): Promise<{
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
        bcc: {
            name: string;
            id: number;
            email: string;
        }[];
        attachments: {
            size: number;
            id: number;
            filename: string;
            mimeType: string;
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
            bcc: {
                name: string;
                id: number;
                email: string;
            }[];
            attachments: {
                size: number;
                id: number;
                filename: string;
                mimeType: string;
            }[];
        }[];
    }>;
    getUncompletedCount(viewerId: number): Promise<number>;
    getUnreadCount(viewerId: number): Promise<number>;
    private setState;
    completeUntil(id: number, viewerId: number): Promise<{
        completed: number;
    }>;
    readUntil(id: number, viewerId: number): Promise<{
        completed: number;
    }>;
    markRead(id: number, viewerId: number): Promise<void>;
    markUnread(id: number, viewerId: number): Promise<void>;
    markComplete(id: number, viewerId: number): Promise<void>;
    markUncomplete(id: number, viewerId: number): Promise<void>;
    send(senderId: number, input: {
        to: number[];
        cc: number[];
        bcc: number[];
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
        bcc: {
            name: string;
            id: number;
            email: string;
        }[];
        attachments: {
            size: number;
            id: number;
            filename: string;
            mimeType: string;
        }[];
    }>;
    private sendInner;
    private discardFiles;
    getAttachment(attachmentId: number, viewerId: number): Promise<{
        storageKey: string;
        size: number;
        id: number;
        createdAt: Date;
        filename: string;
        mimeType: string;
        storagePath: string;
        messageId: number;
    }>;
    addSseClient(id: string, userId: number, subject: Subject<{
        data: string;
    }>): void;
    removeSseClient(id: string): void;
    broadcastNewMessage(userId: number, meta?: NewMessageMeta): void;
}
