import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { AssignTaskDto } from './dto/assign-task.dto.js';
export declare class TasksService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<{
        id: number;
        title: string;
        description: string | null;
        isGeneral: boolean;
        createdAt: Date;
        openTodos: number;
    }[]>;
    create(dto: CreateTaskDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        title: string;
        description: string | null;
        isGeneral: boolean;
    }>;
    update(id: number, dto: UpdateTaskDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        title: string;
        description: string | null;
        isGeneral: boolean;
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
    assignToCompany(taskId: number, dto: AssignTaskDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        dueDate: Date | null;
        resolved: boolean;
        resolvedAt: Date | null;
        taskId: number;
        companyId: number;
        scheduleId: number | null;
    } | {
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        taskId: number;
        companyId: number;
        cycle: number;
    }>;
    private createSchedulesForAllCompanies;
}
