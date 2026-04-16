import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
export declare class TaskSchedulesService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateScheduleDto): Promise<{
        task: {
            id: number;
            title: string;
        };
    } & {
        id: number;
        createdAt: Date;
        deletedAt: Date | null;
        companyId: number;
        taskId: number;
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
        companyId: number;
        taskId: number;
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
        companyId: number;
        taskId: number;
        cycle: number;
    }>;
    remove(id: number): Promise<void>;
}
