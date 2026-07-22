import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
export declare class CommunicationsController {
    private readonly gmail;
    private readonly microsoft;
    private readonly resolver;
    constructor(gmail: GmailService, microsoft: MicrosoftService, resolver: ProviderResolverService);
    account(companyId: number): Promise<import("./communications.types.js").CommunicationsAccountDto | null>;
    uncompletedCounts(): Promise<Record<number, number>>;
}
