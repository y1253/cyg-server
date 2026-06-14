import { OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
export declare class SchedulerService implements OnApplicationBootstrap {
    private readonly prisma;
    private readonly logger;
    constructor(prisma: PrismaService);
    onApplicationBootstrap(): Promise<void>;
    createDueTodos(): Promise<void>;
    private processSchedule;
}
