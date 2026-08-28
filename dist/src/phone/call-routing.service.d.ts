import { PrismaService } from '../prisma/prisma.service.js';
export interface CallRoute {
    companyId: number;
    companyName: string;
    targetUserIds: number[];
    viaAdminFallback: boolean;
}
export declare class CallRoutingService {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    resolve(to: string): Promise<CallRoute | null>;
    private findActiveNumber;
}
