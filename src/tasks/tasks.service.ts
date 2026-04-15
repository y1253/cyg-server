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
        isGeneral: dto.isGeneral ?? false,
      },
    });

    if (task.isGeneral) {
      await this.createTodosForAllCompanies(task.id);
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
        isGeneral: dto.isGeneral,
      },
    });

    // If isGeneral was just switched ON, create todos for all companies that lack one
    if (!wasGeneral && updated.isGeneral) {
      await this.createTodosForAllCompanies(id);
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

    const todo = await this.prisma.todo.create({
      data: {
        taskId,
        companyId: dto.companyId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        cycle: dto.cycle ?? null,
      },
    });

    return todo;
  }

  private async createTodosForAllCompanies(taskId: number) {
    const companies = await this.prisma.company.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });

    // Only create for companies that don't already have an unresolved todo for this task
    const existing = await this.prisma.todo.findMany({
      where: { taskId, resolved: false },
      select: { companyId: true },
    });
    const existingIds = new Set(existing.map(t => t.companyId));

    const newTodos = companies
      .filter(c => !existingIds.has(c.id))
      .map(c => ({ taskId, companyId: c.id }));

    if (newTodos.length > 0) {
      await this.prisma.todo.createMany({ data: newTodos });
    }
  }
}
