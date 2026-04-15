import { PrismaService } from '../prisma/prisma.service.js';
export declare class TodosService {
    private prisma;
    constructor(prisma: PrismaService);
    toggleResolve(id: number, userId: number, userRole: string): Promise<{
        id: number;
        resolved: boolean;
        resolvedAt: Date | null;
    }>;
    remove(id: number): Promise<void>;
    setCycle(id: number, cycle: number): Promise<{
        task: {
            id: number;
            title: string;
            description: string | null;
        };
    } & {
        id: number;
        createdAt: Date;
        updatedAt: Date;
        dueDate: Date | null;
        resolved: boolean;
        resolvedAt: Date | null;
        taskId: number;
        companyId: number;
        scheduleId: number | null;
    }>;
    removeCycle(id: number): Promise<{
        id: number;
        scheduleId: null;
    }>;
}
