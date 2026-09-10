import { PrismaService } from '../prisma/prisma.service.js';
export declare class SmsOptOutService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    optOut(phoneNumber: string, keyword: string): Promise<void>;
    optIn(phoneNumber: string): Promise<void>;
    isOptedOut(phoneNumber: string): Promise<boolean>;
}
