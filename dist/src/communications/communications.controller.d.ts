import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InternalMessagesService } from '../internal-messages/internal-messages.service.js';
import { InternalCallsService } from '../internal-calls/internal-calls.service.js';
import { PhoneTimelineService } from '../phone/phone-timeline.service.js';
import { UnreadFeedService } from './unread-feed.service.js';
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
    constructor(gmail: GmailService, microsoft: MicrosoftService, resolver: ProviderResolverService, internal: InternalMessagesService, internalCalls: InternalCallsService, phoneTimeline: PhoneTimelineService, unreadFeed: UnreadFeedService, prisma: PrismaService);
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
}
