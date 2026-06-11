import { TaskSchedulesService } from './task-schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { UpdateScheduleUserNoteDto } from './dto/update-schedule-user-note.dto';
export declare class TaskSchedulesController {
    private readonly service;
    constructor(service: TaskSchedulesService);
    create(dto: CreateScheduleDto): Promise<{
        cycleType: string;
        cycleDay: number | null;
        cycleNth: number | null;
        startDate: string;
        isManuallyAdded: boolean;
        task: {
            id: number;
            title: string;
        };
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        cycle: number;
        taskId: number;
        isImportant: boolean;
        userNote: string | null;
    }>;
    findByCompany(companyId: number): Promise<({
        task: {
            id: number;
            title: string;
            description: string | null;
            canBeDisabled: boolean;
            orderNumber: number | null;
        };
        todos: {
            resolved: boolean;
            dueDate: Date | null;
        }[];
    } & {
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        startDate: Date | null;
        note: string | null;
        cycleType: import("@prisma/client").$Enums.CycleType;
        cycle: number;
        cycleDay: number | null;
        cycleNth: number | null;
        taskId: number;
        isImportant: boolean;
        userNote: string | null;
        isManuallyAdded: boolean;
    })[] | {
        cycleType: string;
        cycleDay: number | null;
        cycleNth: number | null;
        startDate: string | null;
        userNote: string | null;
        isManuallyAdded: boolean;
        nextTodoDate: string;
        task: {
            id: number;
            title: string;
            description: string | null;
            canBeDisabled: boolean;
            orderNumber: number | null;
        };
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        cycle: number;
        taskId: number;
        isImportant: boolean;
    }[]>;
    update(id: number, dto: UpdateScheduleDto): Promise<{
        cycleType: string;
        cycleDay: number | null;
        cycleNth: number | null;
        startDate: string | null;
        nextTodoDate: string;
        task: {
            id: number;
            title: string;
        };
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        cycle: number;
        taskId: number;
        isImportant: boolean;
        userNote: string | null;
        isManuallyAdded: boolean;
    }>;
    toggle(id: number): Promise<{
        cycleType: string;
        cycleDay: number | null;
        cycleNth: number | null;
        startDate: string | null;
        task: {
            id: number;
            title: string;
            description: string | null;
            canBeDisabled: boolean;
        };
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        cycle: number;
        taskId: number;
        isImportant: boolean;
        userNote: string | null;
        isManuallyAdded: boolean;
    }>;
    toggleImportant(id: number): Promise<{
        id: number;
        isImportant: boolean;
    }>;
    updateUserNote(id: number, body: UpdateScheduleUserNoteDto): Promise<void>;
    deleteSchedule(id: number): Promise<void>;
}
