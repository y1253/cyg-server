import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { computeNextDue } from '../task-schedules/compute-next-due.js';

@Injectable()
export class TodosService {
  constructor(private prisma: PrismaService) {}

  async toggleResolve(id: number, userId: number, userRole: string) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
      include: {
        company: {
          include: { assignments: { select: { userId: true } } },
        },
        schedule: true,
      },
    });

    if (!todo) throw new NotFoundException('Todo not found');

    if (userRole !== 'ADMIN') {
      const assigned = todo.company.assignments.some(a => a.userId === userId);
      if (!assigned) throw new ForbiddenException('Not assigned to this company');
    }

    const newResolved = !todo.resolved;
    const resolvedAt = newResolved ? new Date() : null;

    const updated = await this.prisma.todo.update({
      where: { id },
      data: { resolved: newResolved, resolvedAt },
    });

    // Auto-create next todo when resolving a scheduled (recurring) todo.
    // Anchor to the original dueDate so early resolution doesn't drift the schedule.
    if (newResolved && todo.scheduleId && todo.schedule && !todo.schedule.deletedAt) {
      const base = todo.dueDate ? new Date(todo.dueDate) : new Date(resolvedAt!);
      const dueDate = computeNextDue(base, todo.schedule as any);

      await this.prisma.todo.create({
        data: {
          taskId: todo.taskId,
          companyId: todo.companyId,
          scheduleId: todo.scheduleId,
          dueDate,
        },
      });
    }

    return {
      id: updated.id,
      resolved: updated.resolved,
      resolvedAt: updated.resolvedAt,
    };
  }

  async remove(id: number) {
    const todo = await this.prisma.todo.findUnique({ where: { id } });
    if (!todo) throw new NotFoundException('Todo not found');
    await this.prisma.todo.delete({ where: { id } });
  }

  async setCycle(id: number, cycle: number) {
    const todo = await this.prisma.todo.findUnique({ where: { id } });
    if (!todo) throw new NotFoundException('Todo not found');

    // Reuse existing non-deleted schedule for this task+company, or create one
    let schedule = await this.prisma.taskSchedule.findFirst({
      where: { taskId: todo.taskId, companyId: todo.companyId, deletedAt: null },
    });

    if (schedule) {
      // Update cycle on existing schedule
      schedule = await this.prisma.taskSchedule.update({
        where: { id: schedule.id },
        data: { cycle },
      });
    } else {
      schedule = await this.prisma.taskSchedule.create({
        data: { taskId: todo.taskId, companyId: todo.companyId, cycle },
      });
    }

    const updated = await this.prisma.todo.update({
      where: { id },
      data: { scheduleId: schedule.id },
      include: { task: { select: { id: true, title: true, description: true } } },
    });

    return updated;
  }

  async removeCycle(id: number) {
    const todo = await this.prisma.todo.findUnique({ where: { id } });
    if (!todo) throw new NotFoundException('Todo not found');

    if (todo.scheduleId) {
      // Soft-delete the schedule to stop future recurrence
      await this.prisma.taskSchedule.update({
        where: { id: todo.scheduleId },
        data: { deletedAt: new Date() },
      });
      // Unlink this todo from the schedule
      await this.prisma.todo.update({
        where: { id },
        data: { scheduleId: null },
      });
    }

    return { id, scheduleId: null };
  }

  async snoozeTodo(id: number, days: number, userId: number, userRole: string) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
      include: {
        company: {
          include: { assignments: { select: { userId: true } } },
        },
      },
    });

    if (!todo) throw new NotFoundException('Todo not found');

    if (userRole !== 'ADMIN') {
      const assigned = todo.company.assignments.some(a => a.userId === userId);
      if (!assigned) throw new ForbiddenException('Not assigned to this company');
    }

    const snoozedUntil = new Date();
    snoozedUntil.setDate(snoozedUntil.getDate() + days);

    const updated = await this.prisma.todo.update({
      where: { id },
      data: { snoozedUntil },
    });

    return { id: updated.id, snoozedUntil: updated.snoozedUntil };
  }

  async unsnoozeTodo(id: number, userId: number, userRole: string) {
    const todo = await this.prisma.todo.findUnique({
      where: { id },
      include: {
        company: {
          include: { assignments: { select: { userId: true } } },
        },
      },
    });

    if (!todo) throw new NotFoundException('Todo not found');

    if (userRole !== 'ADMIN') {
      const assigned = todo.company.assignments.some(a => a.userId === userId);
      if (!assigned) throw new ForbiddenException('Not assigned to this company');
    }

    const updated = await this.prisma.todo.update({
      where: { id },
      data: { snoozedUntil: null },
    });

    return { id: updated.id, snoozedUntil: null };
  }

}
