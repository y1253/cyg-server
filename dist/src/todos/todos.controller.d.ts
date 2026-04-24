import { TodosService } from './todos.service.js';
import { SetCycleDto } from './dto/set-cycle.dto.js';
export declare class TodosController {
    private readonly todosService;
    constructor(todosService: TodosService);
    toggleResolve(id: number, req: {
        user: {
            userId: number;
            role: string;
        };
    }): Promise<{
        id: number;
        resolved: boolean;
        resolvedAt: Date | null;
    }>;
    remove(id: number): Promise<void>;
    setCycle(id: number, dto: SetCycleDto): Promise<{
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
