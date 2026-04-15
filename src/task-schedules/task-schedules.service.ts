import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';

@Injectable()
export class TaskSchedulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateScheduleDto) {
    // Check for existing non-deleted schedule
    const existing = await this.prisma.taskSchedule.findFirst({
      where: { taskId: dto.taskId, companyId: dto.companyId, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException('A schedule for this task and company already exists');
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + dto.cycle);

    const schedule = await this.prisma.taskSchedule.create({
      data: {
        taskId: dto.taskId,
        companyId: dto.companyId,
        cycle: dto.cycle,
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
      where: { companyId, deletedAt: null },
      include: { task: { select: { id: true, title: true, description: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async update(id: number, dto: UpdateScheduleDto) {
    const schedule = await this.prisma.taskSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    return this.prisma.taskSchedule.update({
      where: { id },
      data: { cycle: dto.cycle },
      include: { task: { select: { id: true, title: true } } },
    });
  }

  async remove(id: number) {
    const schedule = await this.prisma.taskSchedule.findFirst({
      where: { id, deletedAt: null },
    });
    if (!schedule) throw new NotFoundException('Schedule not found');

    await this.prisma.taskSchedule.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}
