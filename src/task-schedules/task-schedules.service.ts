import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { computeNextDue } from './compute-next-due';

interface ScheduleCycleRow {
  id: number;
  cycleType: string;
  cycleDay: number | null;
  cycleNth: number | null;
}

@Injectable()
export class TaskSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateScheduleDto) {
    const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });

    const cycleType = dto.cycleType ?? 'DAYS';
    const cycle = dto.cycle ?? 30;
    const cycleDay = dto.cycleDay ?? null;
    const cycleNth = dto.cycleNth ?? null;

    const dueDate = computeNextDue(new Date(), { cycleType, cycle, cycleDay, cycleNth });

    const schedule = await this.prisma.taskSchedule.create({
      data: {
        taskId: dto.taskId,
        companyId: dto.companyId,
        cycle,
        note: dto.note,
        isImportant: task?.isImportant ?? false,
        todos: {
          create: { taskId: dto.taskId, companyId: dto.companyId, dueDate },
        },
      },
      include: { task: { select: { id: true, title: true } } },
    });

    await this.prisma.$executeRaw`
      UPDATE TaskSchedule SET cycleType = ${cycleType}, cycleDay = ${cycleDay}, cycleNth = ${cycleNth}
      WHERE id = ${schedule.id}
    `;

    return { ...schedule, cycleType, cycleDay, cycleNth };
  }

  async findByCompany(companyId: number) {
    const schedules = await this.prisma.taskSchedule.findMany({
      where: { companyId },
      include: { task: { select: { id: true, title: true, description: true } } },
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (schedules.length === 0) return schedules;

    // Raw SQL to read columns that the old Prisma client doesn't know about yet
    const cycleRows = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
      SELECT id, cycleType, cycleDay, cycleNth FROM TaskSchedule WHERE companyId = ${companyId}
    `;
    const cycleMap = new Map(cycleRows.map(r => [Number(r.id), r]));

    return schedules.map(s => ({
      ...s,
      cycleType: cycleMap.get(s.id)?.cycleType ?? 'DAYS',
      cycleDay: cycleMap.get(s.id)?.cycleDay ?? null,
      cycleNth: cycleMap.get(s.id)?.cycleNth ?? null,
    }));
  }

  async update(id: number, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');

    const updated = await this.prisma.taskSchedule.update({
      where: { id },
      data: {
        cycle: dto.cycle,
        note: dto.note,
      },
      include: { task: { select: { id: true, title: true } } },
    });

    if (dto.cycleType !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE TaskSchedule SET cycleType = ${dto.cycleType}, cycleDay = ${dto.cycleDay ?? null}, cycleNth = ${dto.cycleNth ?? null}
        WHERE id = ${id}
      `;
    }

    const [cycleRow] = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
      SELECT id, cycleType, cycleDay, cycleNth FROM TaskSchedule WHERE id = ${id}
    `;

    return {
      ...updated,
      cycleType: cycleRow?.cycleType ?? 'DAYS',
      cycleDay: cycleRow?.cycleDay ?? null,
      cycleNth: cycleRow?.cycleNth ?? null,
    };
  }

  async toggle(id: number) {
    const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');

    const updated = await this.prisma.taskSchedule.update({
      where: { id },
      data: { deletedAt: schedule.deletedAt ? null : new Date() },
      include: { task: { select: { id: true, title: true, description: true } } },
    });

    const [cycleRow] = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
      SELECT id, cycleType, cycleDay, cycleNth FROM TaskSchedule WHERE id = ${id}
    `;

    return {
      ...updated,
      cycleType: cycleRow?.cycleType ?? 'DAYS',
      cycleDay: cycleRow?.cycleDay ?? null,
      cycleNth: cycleRow?.cycleNth ?? null,
    };
  }

  async toggleImportant(id: number) {
    const schedule = await this.prisma.taskSchedule.findUnique({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return this.prisma.taskSchedule.update({
      where: { id },
      data: { isImportant: !schedule.isImportant },
      select: { id: true, isImportant: true },
    });
  }
}
