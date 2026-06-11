import { TodosService } from './todos.service.js';
import { SetCycleDto } from './dto/set-cycle.dto.js';
import { SnoozeTodoDto } from './dto/snooze-todo.dto.js';
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
        dueDate: Date | null;
        resolvedAt: Date | null;
        snoozedUntil: Date | null;
        taskId: number;
        scheduleId: number | null;
    }>;
    removeCycle(id: number): Promise<{
        id: number;
        scheduleId: null;
    }>;
    snoozeTodo(id: number, dto: SnoozeTodoDto, req: {
        user: {
            userId: number;
            role: string;
        };
    }): Promise<{
        id: number;
        snoozedUntil: Date | null;
    }>;
    unsnoozeTodo(id: number, req: {
        user: {
            userId: number;
            role: string;
        };
    }): Promise<{
        id: number;
        snoozedUntil: null;
    }>;
}
