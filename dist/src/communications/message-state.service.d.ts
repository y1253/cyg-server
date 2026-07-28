import { PrismaService } from '../prisma/prisma.service.js';
export declare class MessageStateService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private readonly logger;
    private rethrowWithIdWidthHint;
    private static readonly UNCOMPLETED_TTL_MS;
    private readonly uncompletedCache;
    private readonly uncompletedInFlight;
    private readonly uncompletedIdsCache;
    markChatRead(companyId: number, messageId: string): Promise<void>;
    markChatUnread(companyId: number, messageId: string): Promise<void>;
    getReadSet(companyId: number): Promise<Set<string>>;
    markComplete(companyId: number, messageId: string): Promise<void>;
    markUncomplete(companyId: number, messageId: string): Promise<void>;
    getCompletedSet(companyId: number): Promise<Set<string>>;
    flushCompleted(companyId: number, ids: string[]): Promise<number>;
    getForwardedSet(companyId: number): Promise<Set<string>>;
    recordForward(companyId: number, messageId: string, recipient: string | null, sentMessageId?: string | null): Promise<void>;
    getForwards(companyId: number, messageId: string): Promise<{
        recipient: string | null;
        forwardedAt: Date;
        sentMessageId: string | null;
    }[]>;
    bustUncompleted(companyId: number): void;
    getUncompletedCount(companyId: number, compute: () => Promise<number>): Promise<{
        count: number;
    }>;
    getCachedEmailIds(companyId: number, q: string | undefined, compute: () => Promise<string[]>): Promise<string[]>;
}
