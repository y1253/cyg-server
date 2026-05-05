import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { AssignTaskDto } from './dto/assign-task.dto.js';
import { computeNextDue } from '../task-schedules/compute-next-due.js';

interface TaskCycleRow {
  id: number;
  defaultCycleType: string;
  defaultCycleDay: number | null;
  defaultCycleNth: number | null;
}

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const tasks = await this.prisma.task.findMany({
      where: { deletedAt: null },
      include: {
        _count: {
          select: {
            todos: {
              where: {
                resolved: false,
                OR: [{ startDate: null }, { startDate: { lte: new Date() } }],
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Raw SQL to read columns that the old Prisma client doesn't know about yet
    const cycleRows = await this.prisma.$queryRaw<TaskCycleRow[]>`
      SELECT id, defaultCycleType, defaultCycleDay, defaultCycleNth
      FROM Task WHERE deletedAt IS NULL
    `;
    const cycleMap = new Map(cycleRows.map(r => [Number(r.id), r]));

    return tasks.map(t => {
      const extra = cycleMap.get(t.id);
      return {
        id: t.id,
        title: t.title,
        description: t.description,
        note: t.note,
        isGeneral: t.isGeneral,
        defaultCycle: t.defaultCycle,
        defaultCycleType: extra?.defaultCycleType ?? 'DAYS',
        defaultCycleDay: extra?.defaultCycleDay ?? null,
        defaultCycleNth: extra?.defaultCycleNth ?? null,
        isImportant: t.isImportant,
        createdAt: t.createdAt,
        openTodos: t._count.todos,
      };
    });
  }

  async create(dto: CreateTaskDto) {
    const existing = await this.prisma.task.findUnique({
      where: { title: dto.title },
    });
    if (existing && !existing.deletedAt) {
      throw new ConflictException('A task with this title already exists');
    }

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        isGeneral: true,
        defaultCycle: dto.defaultCycle ?? 30,
        isImportant: dto.isImportant ?? false,
      },
    });

    const cycleType = dto.defaultCycleType ?? 'DAYS';
    const cycleDay = dto.defaultCycleDay ?? null;
    const cycleNth = dto.defaultCycleNth ?? null;

    await this.prisma.$executeRaw`
      UPDATE Task SET defaultCycleType = ${cycleType}, defaultCycleDay = ${cycleDay}, defaultCycleNth = ${cycleNth}
      WHERE id = ${task.id}
    `;

    const fullTask = { ...task, defaultCycleType: cycleType, defaultCycleDay: cycleDay, defaultCycleNth: cycleNth };

    if (fullTask.isGeneral) {
      await this.createSchedulesForAllCompanies(fullTask);
    }

    return fullTask;
  }

  async update(id: number, dto: UpdateTaskDto) {
    const task = await this.prisma.task.findFirst({
      where: { id, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    if (dto.title && dto.title !== task.title) {
      const conflict = await this.prisma.task.findUnique({
        where: { title: dto.title },
      });
      if (conflict && !conflict.deletedAt && conflict.id !== id) {
        throw new ConflictException('A task with this title already exists');
      }
    }

    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        defaultCycle: dto.defaultCycle,
        isImportant: dto.isImportant,
      },
    });

    if (dto.defaultCycleType !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE Task SET defaultCycleType = ${dto.defaultCycleType}, defaultCycleDay = ${dto.defaultCycleDay ?? null}, defaultCycleNth = ${dto.defaultCycleNth ?? null}
        WHERE id = ${id}
      `;
    }

    const [cycleRow] = await this.prisma.$queryRaw<TaskCycleRow[]>`
      SELECT id, defaultCycleType, defaultCycleDay, defaultCycleNth FROM Task WHERE id = ${id}
    `;

    return {
      ...updated,
      defaultCycleType: cycleRow?.defaultCycleType ?? 'DAYS',
      defaultCycleDay: cycleRow?.defaultCycleDay ?? null,
      defaultCycleNth: cycleRow?.defaultCycleNth ?? null,
    };
  }

  async remove(id: number) {
    const task = await this.prisma.task.findFirst({
      where: { id, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    await this.prisma.$transaction([
      this.prisma.todo.deleteMany({ where: { taskId: id } }),
      this.prisma.taskSchedule.deleteMany({ where: { taskId: id } }),
      this.prisma.task.delete({ where: { id } }),
    ]);

    return { id };
  }

  async assignToCompany(taskId: number, dto: AssignTaskDto) {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');

    const company = await this.prisma.company.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');

    if (dto.cycle) {
      // Recurring: create a TaskSchedule + first todo
      const dueDate = dto.dueDate
        ? new Date(dto.dueDate)
        : (() => { const d = new Date(); d.setDate(d.getDate() + dto.cycle!); return d; })();

      const schedule = await this.prisma.taskSchedule.create({
        data: {
          taskId,
          companyId: dto.companyId,
          cycle: dto.cycle,
          isImportant: task.isImportant,
          todos: {
            create: { taskId, companyId: dto.companyId, dueDate },
          },
        },
      });

      return schedule;
    } else {
      // One-time: create a standalone todo (standalone todos are never important)
      const todo = await this.prisma.todo.create({
        data: {
          taskId,
          companyId: dto.companyId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          note: dto.note ?? null,
        },
      });
      return todo;
    }
  }

  private async createSchedulesForAllCompanies(task: {
    id: number;
    defaultCycle: number;
    defaultCycleType: string;
    defaultCycleDay: number | null;
    defaultCycleNth: number | null;
    isImportant: boolean;
  }) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    const existingSchedules = await this.prisma.taskSchedule.findMany({
      where: { taskId: task.id, deletedAt: null },
      select: { companyId: true },
    });
    const scheduledIds = new Set(existingSchedules.map(s => s.companyId));

    for (const company of companies) {
      if (scheduledIds.has(company.id)) continue;

      const dueDate = computeNextDue(new Date(), {
        cycleType: task.defaultCycleType,
        cycle: task.defaultCycle,
        cycleDay: task.defaultCycleDay,
        cycleNth: task.defaultCycleNth,
      });

      const schedule = await this.prisma.taskSchedule.create({
        data: {
          taskId: task.id,
          companyId: company.id,
          cycle: task.defaultCycle,
          isImportant: task.isImportant,
          todos: {
            create: { taskId: task.id, companyId: company.id, dueDate },
          },
        },
      });

      await this.prisma.$executeRaw`
        UPDATE TaskSchedule SET cycleType = ${task.defaultCycleType}, cycleDay = ${task.defaultCycleDay ?? null}, cycleNth = ${task.defaultCycleNth ?? null}
        WHERE id = ${schedule.id}
      `;
    }
  }
}
