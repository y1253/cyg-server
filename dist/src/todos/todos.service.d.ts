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
        resolved: boolean;
        companyId: number;
        startDate: Date | null;
        dueDate: Date | null;
        resolvedAt: Date | null;
        taskId: number;
        scheduleId: number | null;
    }>;
    removeCycle(id: number): Promise<{
        id: number;
        scheduleId: null;
    }>;
}
