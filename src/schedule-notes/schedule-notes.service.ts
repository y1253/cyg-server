import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class ScheduleNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(scheduleId: number, userId: number, note: string) {
    return this.prisma.scheduleNote.upsert({
      where: { scheduleId_userId: { scheduleId, userId } },
      create: { scheduleId, userId, note },
      update: { note },
    });
  }

  async remove(scheduleId: number, userId: number) {
    await this.prisma.scheduleNote.deleteMany({
      where: { scheduleId, userId },
    });
    return { ok: true };
  }

  async findBySchedule(scheduleId: number) {
    return this.prisma.scheduleNote.findMany({
      where: { scheduleId },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }
}
