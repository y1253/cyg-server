import { TasksService } from './tasks.service.js';
import { AssignTaskDto } from './dto/assign-task.dto.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
export declare class TasksController {
    private readonly tasksService;
    constructor(tasksService: TasksService);
    findAll(): Promise<{
        id: number;
        title: string;
        description: string | null;
        note: string | null;
        isGeneral: boolean;
        createdAt: Date;
        openTodos: number;
    }[]>;
    create(dto: CreateTaskDto): Promise<{
        note: string | null;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        title: string;
        description: string | null;
        isGeneral: boolean;
    }>;
    update(id: number, dto: UpdateTaskDto): Promise<{
        note: string | null;
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
    assignToCompany(id: number, dto: AssignTaskDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        resolved: boolean;
        companyId: number;
        dueDate: Date | null;
        resolvedAt: Date | null;
        taskId: number;
        scheduleId: number | null;
    } | {
        note: string | null;
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        taskId: number;
        cycle: number;
    }>;
}
