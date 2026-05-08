import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { computeNextDue, computeFirstDue } from './compute-next-due';

interface ScheduleCycleRow {
  id: number;
  cycleType: string;
  cycleDay: number | null;
  cycleNth: number | null;
  startDate: Date | null;
  userNote: string | null;
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
      include: {
        task: { select: { id: true, title: true, description: true, canBeDisabled: true } },
        todos: {
          where: { resolved: false },
          orderBy: { dueDate: 'asc' },
          take: 1,
          select: { dueDate: true },
        },
      },
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
    });

    if (schedules.length === 0) return schedules;

    // Raw SQL to read columns that the old Prisma client doesn't know about yet
    const cycleRows = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
      SELECT id, cycleType, cycleDay, cycleNth, startDate, userNote FROM TaskSchedule WHERE companyId = ${companyId}
    `;
    const cycleMap = new Map(cycleRows.map(r => [Number(r.id), r]));

    return schedules.map(({ todos, ...s }) => ({
      ...s,
      cycleType: cycleMap.get(s.id)?.cycleType ?? 'DAYS',
      cycleDay: cycleMap.get(s.id)?.cycleDay ?? null,
      cycleNth: cycleMap.get(s.id)?.cycleNth ?? null,
      startDate: cycleMap.get(s.id)?.startDate?.toISOString() ?? null,
      userNote: cycleMap.get(s.id)?.userNote ?? null,
      nextTodoDate: todos[0]?.dueDate?.toISOString() ?? null,
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

    const cycleChanged = (dto.cycle !== undefined || dto.cycleType !== undefined) && dto.startDate === undefined;
    if (cycleChanged) {
      await this.prisma.todo.deleteMany({
        where: { scheduleId: id, resolved: false, dueDate: { gt: new Date() } },
      });
      const [freshRow] = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
        SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
      `;
      const newArgs = {
        cycle: updated.cycle,
        cycleType: freshRow?.cycleType ?? 'DAYS',
        cycleDay: freshRow?.cycleDay ?? null,
        cycleNth: freshRow?.cycleNth ?? null,
      };
      const todayStr = new Date().toISOString().slice(0, 10);
      const sdStr = freshRow?.startDate?.toISOString().slice(0, 10) ?? null;
      const nextDue = sdStr && sdStr > todayStr
        ? computeFirstDue(freshRow!.startDate!, newArgs)
        : computeNextDue(new Date(), newArgs);
      await this.prisma.todo.create({
        data: { taskId: schedule.taskId, companyId: schedule.companyId, scheduleId: id, dueDate: nextDue },
      });
    }

    if (dto.startDate !== undefined) {
      const sd = dto.startDate ? new Date(dto.startDate) : null;
      await this.prisma.$executeRaw`
        UPDATE TaskSchedule SET startDate = ${sd} WHERE id = ${id}
      `;
      if (sd) {
        // Delete all unresolved todos and regenerate from the start date
        await this.prisma.todo.deleteMany({ where: { scheduleId: id, resolved: false } });
        const [cycleRow] = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
          SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
        `;
        const scheduleArgs = {
          cycle: updated.cycle,
          cycleType: cycleRow?.cycleType ?? 'DAYS',
          cycleDay: cycleRow?.cycleDay ?? null,
          cycleNth: cycleRow?.cycleNth ?? null,
        };
        const todayStr = new Date().toISOString().slice(0, 10);
        const sdStr = sd.toISOString().slice(0, 10);
        const firstDue = sdStr > todayStr
          ? computeFirstDue(sd, scheduleArgs)
          : computeNextDue(new Date(), scheduleArgs);
        await this.prisma.todo.create({
          data: { taskId: schedule.taskId, companyId: schedule.companyId, scheduleId: id, dueDate: firstDue },
        });
      }
    }

    const [cycleRow] = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
      SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
    `;

    return {
      ...updated,
      cycleType: cycleRow?.cycleType ?? 'DAYS',
      cycleDay: cycleRow?.cycleDay ?? null,
      cycleNth: cycleRow?.cycleNth ?? null,
      startDate: cycleRow?.startDate?.toISOString() ?? null,
    };
  }

  async toggle(id: number) {
    const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');

    const updated = await this.prisma.taskSchedule.update({
      where: { id },
      data: { deletedAt: schedule.deletedAt ? null : new Date() },
      include: { task: { select: { id: true, title: true, description: true, canBeDisabled: true } } },
    });

    const [cycleRow] = await this.prisma.$queryRaw<ScheduleCycleRow[]>`
      SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
    `;

    return {
      ...updated,
      cycleType: cycleRow?.cycleType ?? 'DAYS',
      cycleDay: cycleRow?.cycleDay ?? null,
      cycleNth: cycleRow?.cycleNth ?? null,
      startDate: cycleRow?.startDate?.toISOString() ?? null,
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

  async updateUserNote(id: number, note: string | undefined) {
    await this.prisma.$executeRaw`
      UPDATE TaskSchedule SET userNote = ${note ?? null} WHERE id = ${id}
    `;
  }
}
