import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateNoteDto } from './dto/create-note.dto.js';
import { UpdateNoteDto } from './dto/update-note.dto.js';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async findByCompany(companyId: number, userId: number) {
    return this.prisma.note.findMany({
      where: { companyId, userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(dto: CreateNoteDto, userId: number) {
    return this.prisma.note.create({
      data: {
        companyId: dto.companyId,
        userId,
        title: dto.title,
        note: dto.note,
      },
    });
  }

  async update(id: number, dto: UpdateNoteDto, userId: number) {
    const note = await this.prisma.note.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== userId) throw new ForbiddenException('Access denied');

    return this.prisma.note.update({
      where: { id },
      data: { title: dto.title, note: dto.note },
    });
  }

  async remove(id: number, userId: number) {
    const note = await this.prisma.note.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== userId) throw new ForbiddenException('Access denied');

    await this.prisma.note.delete({ where: { id } });
    return { id };
  }
}
