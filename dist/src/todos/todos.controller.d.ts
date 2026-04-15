import { TodosService } from './todos.service.js';
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
}
