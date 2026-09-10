import type { PrismaService } from '../prisma/prisma.service.js';
export interface CompanyTarget {
    id: number;
    businessName: string;
    isInternal: boolean;
}
export declare function assertRealCompany(prisma: PrismaService, companyId: number, internalMessage: string): Promise<CompanyTarget>;
