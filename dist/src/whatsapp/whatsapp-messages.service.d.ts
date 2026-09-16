import { PrismaService } from '../prisma/prisma.service.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import { WhatsAppGraphService } from './whatsapp-graph.service.js';
import { type ParsedChange } from './whatsapp.util.js';
import type { WhatsAppCounts, WhatsAppItemDto, WhatsAppStateAction, WhatsAppTemplateDto, WhatsAppThreadResult, WhatsAppTimelineResult } from './whatsapp.types.js';
export declare const WHATSAPP_SUBDIR = "whatsapp";
export declare const MAX_VOICE_BYTES: number;
export interface UploadedVoice {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
    size: number;
}
export declare class WhatsAppMessagesService {
    private readonly prisma;
    private readonly graph;
    private readonly accounts;
    private readonly logger;
    private readonly mediaInFlight;
    private mediaSweepRunning;
    constructor(prisma: PrismaService, graph: WhatsAppGraphService, accounts: WhatsAppAccountService);
    ingest(changes: ParsedChange[]): Promise<void>;
    private applyStatus;
    fetchMedia(messageId: number): Promise<void>;
    retryPendingMedia(): Promise<void>;
    mediaFile(messageId: number, variant: 'original' | 'playback'): Promise<{
        absolutePath: string;
        mimeType: string;
        filename: string;
    }>;
    private store;
    private makePlayback;
    private answeredPeers;
    getTimeline(companyId: number, cursor: number | undefined, limit: number): Promise<WhatsAppTimelineResult>;
    getThread(companyId: number, rawPeer: string): Promise<WhatsAppThreadResult>;
    getCounts(companyId: number): Promise<WhatsAppCounts>;
    getUncompletedCountsForAll(): Promise<Record<number, number>>;
    getUnreadItems(companyId: number, limit: number): Promise<WhatsAppItemDto[]>;
    setState(companyId: number, messageId: number, action: WhatsAppStateAction): Promise<void>;
    sendText(companyId: number, to: string, body: string, userId: number): Promise<WhatsAppItemDto>;
    listTemplates(companyId: number): Promise<WhatsAppTemplateDto[]>;
    sendTemplateMessage(companyId: number, to: string, name: string, language: string, variables: string[], userId: number): Promise<WhatsAppItemDto>;
    sendVoice(companyId: number, to: string, file: UploadedVoice, userId: number): Promise<WhatsAppItemDto>;
    private lastInbound;
    private assertWindowOpen;
    private contactNames;
}
