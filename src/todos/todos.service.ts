import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

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
      },
    });

    if (!todo) throw new NotFoundException('Todo not found');

    if (userRole !== 'ADMIN') {
      const assigned = todo.company.assignments.some(a => a.userId === userId);
      if (!assigned) throw new ForbiddenException('Not assigned to this company');
    }

    const newResolved = !todo.resolved;
    const updated = await this.prisma.todo.update({
      where: { id },
      data: {
        resolved: newResolved,
        resolvedAt: newResolved ? new Date() : null,
      },
    });

    return {
      id: updated.id,
      resolved: updated.resolved,
      resolvedAt: updated.resolvedAt,
    };
  }
}
