import type { PrismaService } from '../prisma/prisma.service.js';
export declare function assertMayUseCompanyPhone(prisma: PrismaService, assignments: {
    userId: number;
}[], userId: number, companyName: string, action: string): Promise<void>;
