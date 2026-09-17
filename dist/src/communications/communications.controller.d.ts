import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InternalMessagesService } from '../internal-messages/internal-messages.service.js';
import { InternalCallsService } from '../internal-calls/internal-calls.service.js';
import { PhoneTimelineService } from '../phone/phone-timeline.service.js';
import { UnreadFeedService } from './unread-feed.service.js';
import { WhatsAppMessagesService } from '../whatsapp/whatsapp-messages.service.js';
import { MessageStateService } from './message-state.service.js';
import { CompleteUntilChatDto, CompleteUntilEmailDto, CompleteUntilIdDto, CompleteUntilSmsDto } from './dto/complete-until.dto.js';
import type { LatestPreviewDto } from './communications.types.js';
import type { InboxSummaryDto } from './unread-feed.types.js';
export declare class CommunicationsController {
    private readonly gmail;
    private readonly microsoft;
    private readonly resolver;
    private readonly internal;
    private readonly internalCalls;
    private readonly phoneTimeline;
    private readonly unreadFeed;
    private readonly prisma;
    private readonly whatsapp;
    private readonly state;
    constructor(gmail: GmailService, microsoft: MicrosoftService, resolver: ProviderResolverService, internal: InternalMessagesService, internalCalls: InternalCallsService, phoneTimeline: PhoneTimelineService, unreadFeed: UnreadFeedService, prisma: PrismaService, whatsapp: WhatsAppMessagesService, state: MessageStateService);
    account(companyId: number): Promise<import("./communications.types.js").CommunicationsAccountDto | null>;
    latestPreview(companyId: number, req: {
        user: {
            userId: number;
        };
    }): Promise<LatestPreviewDto | null>;
    inboxSummary(req: {
        user: {
            userId: number;
        };
    }): Promise<InboxSummaryDto>;
    completeEmailsUntil(companyId: number, dto: CompleteUntilEmailDto): Promise<{
        completed: number;
    }>;
    completeChatsUntil(companyId: number, dto: CompleteUntilChatDto): Promise<{
        completed: number;
    }>;
    completeSmsUntil(companyId: number, dto: CompleteUntilSmsDto): Promise<{
        completed: number;
    }>;
    completeWhatsAppUntil(companyId: number, dto: CompleteUntilIdDto): Promise<{
        completed: number;
    }>;
    completeInternalUntil(dto: CompleteUntilIdDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        completed: number;
    }>;
}
