import { type SupportNumber } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from './signalwire.service.js';
import { type AvailableNumber } from './signalwire-parse.js';
export interface ProvisionOutcome {
    status: 'attached' | 'skipped' | 'failed';
    reason?: string;
    number?: SupportNumber;
}
export declare class PhoneProvisioningService {
    private readonly prisma;
    private readonly signalwire;
    private readonly logger;
    constructor(prisma: PrismaService, signalwire: SignalWireService);
    getActiveNumber(companyId: number): Promise<SupportNumber | null>;
    searchAvailable(country: string, areaCode?: string): Promise<AvailableNumber[]>;
    private searchEligible;
    private eligible;
    attachNumber(companyId: number, phoneNumber: string, region?: string | null): Promise<SupportNumber>;
    releaseNumber(companyId: number): Promise<void>;
    autoProvisionForCompany(companyId: number): Promise<ProvisionOutcome>;
    purgeForCompany(companyId: number): Promise<void>;
    private assertProvisionable;
    private underDailyCap;
}
