import { PrismaService } from '../prisma/prisma.service.js';
export declare class TodosService {
    private prisma;
    constructor(prisma: PrismaService);
    toggleResolve(id: number, userId: number, userRole: string): Promise<{
        id: number;
        resolved: boolean;
        resolvedAt: Date | null;
    }>;
}
