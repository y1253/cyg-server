import type { PrismaService } from '../prisma/prisma.service.js';
export declare function isOwnCompany(prisma: PrismaService, companyId: number, userId: number): Promise<boolean>;
export declare function assertOwnCompany(prisma: PrismaService, companyId: number, userId: number): Promise<void>;
export declare function listOwnCompanies(prisma: PrismaService, userId: number): Promise<{
    id: number;
    businessName: string;
    isInternal: boolean;
}[]>;
