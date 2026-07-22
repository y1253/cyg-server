import { PrismaService } from '../prisma/prisma.service.js';
import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import type { CommunicationsProvider } from './provider.interface.js';
import type { CommunicationsProviderKind } from './communications.types.js';
export declare class ProviderResolverService {
    private readonly prisma;
    private readonly gmail;
    private readonly microsoft;
    constructor(prisma: PrismaService, gmail: GmailService, microsoft: MicrosoftService);
    getConnectedProvider(companyId: number): Promise<CommunicationsProviderKind | null>;
    resolve(companyId: number): Promise<CommunicationsProvider | null>;
}
