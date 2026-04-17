import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { AssignTaskDto } from './dto/assign-task.dto.js';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const tasks = await this.prisma.task.findMany({
      where: { deletedAt: null },
      include: {
        _count: {
          select: { todos: { where: { resolved: false } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      note: t.note,
      isGeneral: t.isGeneral,
      createdAt: t.createdAt,
      openTodos: t._count.todos,
    }));
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
        note: dto.note,
        isGeneral: dto.isGeneral ?? false,
      },
    });

    if (task.isGeneral) {
      await this.createSchedulesForAllCompanies(task.id);
    }

    return task;
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

    const wasGeneral = task.isGeneral;
    const updated = await this.prisma.task.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        note: dto.note,
        isGeneral: dto.isGeneral,
      },
    });

    // If isGeneral was just switched ON, create schedules for all companies that lack one
    if (!wasGeneral && updated.isGeneral) {
      await this.createSchedulesForAllCompanies(id);
    }

    return updated;
  }

  async remove(id: number) {
    const task = await this.prisma.task.findFirst({
      where: { id, deletedAt: null },
    });
    if (!task) throw new NotFoundException('Task not found');
    await this.prisma.task.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
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
      const existing = await this.prisma.taskSchedule.findFirst({
        where: { taskId, companyId: dto.companyId, deletedAt: null },
      });
      if (existing) {
        throw new ConflictException('A schedule for this task and company already exists');
      }

      const dueDate = dto.dueDate
        ? new Date(dto.dueDate)
        : (() => { const d = new Date(); d.setDate(d.getDate() + dto.cycle!); return d; })();

      const schedule = await this.prisma.taskSchedule.create({
        data: {
          taskId,
          companyId: dto.companyId,
          cycle: dto.cycle,
          todos: {
            create: { taskId, companyId: dto.companyId, dueDate },
          },
        },
      });

      return schedule;
    } else {
      // One-time: create a standalone todo
      const todo = await this.prisma.todo.create({
        data: {
          taskId,
          companyId: dto.companyId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        },
      });
      return todo;
    }
  }

  // Creates a TaskSchedule (cycle=30) + initial todo for every company that
  // doesn't already have an active schedule for this task.
  private async createSchedulesForAllCompanies(taskId: number) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    const existingSchedules = await this.prisma.taskSchedule.findMany({
      where: { taskId, deletedAt: null },
      select: { companyId: true },
    });
    const scheduledIds = new Set(existingSchedules.map(s => s.companyId));

    const CYCLE = 30;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + CYCLE);

    for (const company of companies) {
      if (scheduledIds.has(company.id)) continue;

      await this.prisma.taskSchedule.create({
        data: {
          taskId,
          companyId: company.id,
          cycle: CYCLE,
          todos: {
            create: { taskId, companyId: company.id, dueDate },
          },
        },
      });
    }
  }
}
