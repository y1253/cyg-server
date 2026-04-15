import { TaskSchedulesService } from './task-schedules.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
export declare class TaskSchedulesController {
    private readonly service;
    constructor(service: TaskSchedulesService);
    create(dto: CreateScheduleDto): Promise<{
        task: {
            id: number;
            title: string;
        };
    } & {
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        taskId: number;
        companyId: number;
        cycle: number;
    }>;
    findByCompany(companyId: number): Promise<({
        task: {
            id: number;
            title: string;
            description: string | null;
        };
    } & {
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        taskId: number;
        companyId: number;
        cycle: number;
    })[]>;
    update(id: number, dto: UpdateScheduleDto): Promise<{
        task: {
            id: number;
            title: string;
        };
    } & {
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        taskId: number;
        companyId: number;
        cycle: number;
    }>;
    remove(id: number): Promise<void>;
}
