import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InternalMessagesService } from '../internal-messages/internal-messages.service.js';
export declare class CommunicationsController {
    private readonly gmail;
    private readonly microsoft;
    private readonly resolver;
    private readonly internal;
    private readonly prisma;
    constructor(gmail: GmailService, microsoft: MicrosoftService, resolver: ProviderResolverService, internal: InternalMessagesService, prisma: PrismaService);
    account(companyId: number): Promise<import("./communications.types.js").CommunicationsAccountDto | null>;
    uncompletedCounts(req: {
        user: {
            userId: number;
        };
    }): Promise<Record<number, number>>;
}
