import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';

@Injectable()
export class LinksService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateLinkDto) {
    return this.prisma.link.create({ data: dto });
  }

  async update(id: number, dto: UpdateLinkDto) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    return this.prisma.link.update({ where: { id }, data: dto });
  }

  async remove(id: number) {
    const link = await this.prisma.link.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Link not found');
    await this.prisma.link.delete({ where: { id } });
  }

  async findByCompany(companyId: number) {
    return this.prisma.link.findMany({ where: { companyId } });
  }
}
