import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateNoteDto } from './dto/create-note.dto.js';
import { UpdateNoteDto } from './dto/update-note.dto.js';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateNoteDto) {
    return this.prisma.companyNote.create({ data: dto });
  }

  async findByCompany(companyId: number) {
    return this.prisma.companyNote.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: number, dto: UpdateNoteDto) {
    const note = await this.prisma.companyNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    return this.prisma.companyNote.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const note = await this.prisma.companyNote.findUnique({ where: { id } });
    if (!note) throw new NotFoundException('Note not found');
    await this.prisma.companyNote.delete({ where: { id } });
  }
}
