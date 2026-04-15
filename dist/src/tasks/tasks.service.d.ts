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
        title: string;
        description: string | null;
        isGeneral: boolean;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }>;
    update(id: number, dto: UpdateTaskDto): Promise<{
        id: number;
        title: string;
        description: string | null;
        isGeneral: boolean;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
    assignToCompany(taskId: number, dto: AssignTaskDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        resolved: boolean;
        cycle: number | null;
        dueDate: Date | null;
        resolvedAt: Date | null;
        taskId: number;
        companyId: number;
    }>;
    private createTodosForAllCompanies;
}
