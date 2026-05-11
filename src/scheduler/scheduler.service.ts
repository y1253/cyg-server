import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  computeNextDue,
  computeFirstDue,
  ScheduleForDue,
} from '../task-schedules/compute-next-due';

interface ScheduleRow {
  id: number;
  taskId: number;
  companyId: number;
  cycle: number;
  cycleType: string;
  cycleDay: number | null;
  cycleNth: number | null;
}

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async createDueTodos() {
    this.logger.log('Daily todo generation job started');

    const schedules = await this.prisma.$queryRaw<ScheduleRow[]>`
      SELECT id, taskId, companyId, cycle, cycleType, cycleDay, cycleNth
      FROM TaskSchedule
      WHERE deletedAt IS NULL
    `;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const schedule of schedules) {
      await this.processSchedule(schedule, today);
    }

    this.logger.log(`Done. Processed ${schedules.length} schedules.`);
  }

  private async processSchedule(schedule: ScheduleRow, today: Date) {
    const sfd: ScheduleForDue = {
      cycle: schedule.cycle,
      cycleType: schedule.cycleType,
      cycleDay: schedule.cycleDay,
      cycleNth: schedule.cycleNth,
    };

    const latest = await this.prisma.todo.findFirst({
      where: { scheduleId: schedule.id },
      orderBy: { dueDate: 'desc' },
      select: { dueDate: true },
    });

    let nextDue = latest?.dueDate
      ? computeNextDue(new Date(latest.dueDate), sfd)
      : computeFirstDue(today, sfd);

    while (nextDue <= today) {
      await this.prisma.todo.create({
        data: {
          taskId: schedule.taskId,
          companyId: schedule.companyId,
          scheduleId: schedule.id,
          dueDate: nextDue,
        },
      });
      nextDue = computeNextDue(nextDue, sfd);
    }
  }
}
