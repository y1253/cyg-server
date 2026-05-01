import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Injectable()
export class TaskSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateScheduleDto) {
    const existing = await this.prisma.taskSchedule.findFirst({
      where: { taskId: dto.taskId, companyId: dto.companyId },
    });
    if (existing) {
      throw new ConflictException(
        existing.deletedAt
          ? 'A disabled schedule for this task already exists. Re-enable it from the list.'
          : 'A schedule for this task and company already exists',
      );
    }

    const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dto.cycle);

    const schedule = await this.prisma.taskSchedule.create({
      data: {
        taskId: dto.taskId,
        companyId: dto.companyId,
        cycle: dto.cycle,
        note: dto.note,
        isImportant: task?.isImportant ?? false,
        todos: {
          create: {
            taskId: dto.taskId,
            companyId: dto.companyId,
            dueDate,
          },
        },
      },
      include: { task: { select: { id: true, title: true } } },
    });

    return schedule;
  }

  async findByCompany(companyId: number) {
    return this.prisma.taskSchedule.findMany({
      where: { companyId },
      include: { task: { select: { id: true, title: true, description: true } } },
      orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async update(id: number, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.prisma.taskSchedule.update({
      where: { id },
      data: { cycle: dto.cycle, note: dto.note },
      include: { task: { select: { id: true, title: true } } },
    });
  }

  async toggle(id: number) {
    const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.prisma.taskSchedule.update({
      where: { id },
      data: { deletedAt: schedule.deletedAt ? null : new Date() },
      include: { task: { select: { id: true, title: true, description: true } } },
    });
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
