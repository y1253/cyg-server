import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private luxand: LuxandService,
  ) {}

  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      include: { faceImages: true },
    });
  }

  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, faceImages: { select: { id: true } }, role: true, createdAt: true, updatedAt: true },
    });
  }

  async findOne(id: number) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
        faceImages: { select: { id: true } },
        assignments: {
          include: {
            company: {
              select: {
                id: true,
                businessName: true,
                country: true,
                status: true,
                supportNumber: true,
                deletedAt: true,
                _count: {
                  select: {
                    todos: {
                      where: {
                        resolved: false,
                        OR: [{ dueDate: null }, { dueDate: { lte: startOfToday } }],
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { assignments, ...rest } = user;
    return {
      ...rest,
      companies: assignments
        .filter(a => !a.company.deletedAt)
        .map(a => ({
          id: a.company.id,
          businessName: a.company.businessName,
          country: a.company.country,
          status: a.company.status,
          supportNumber: a.company.supportNumber,
          openTodos: a.company._count.todos,
        })),
    };
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Email already in use');

    return this.prisma.user.create({
      data: { name: dto.name, email: dto.email, role: dto.role },
      select: { id: true, name: true, email: true, faceImages: { select: { id: true } }, role: true, createdAt: true, updatedAt: true },
    });
  }

  async update(id: number, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('User not found');

    if (dto.email && dto.email !== existing.email) {
      const conflict = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (conflict) throw new ConflictException('Email already in use');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, name: true, email: true, faceImages: { select: { id: true } }, role: true, createdAt: true, updatedAt: true },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { faceImages: true },
    });
    if (!existing || existing.deletedAt) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    await Promise.allSettled(existing.faceImages.map(fi => this.luxand.deletePerson(fi.luxandId)));
    await this.prisma.faceImage.deleteMany({ where: { userId: id } });
    return { id };
  }

  async enrollFace(id: number, photos: { buffer: Buffer; mimeType: string }[]) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { faceImages: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await Promise.allSettled(user.faceImages.map(fi => this.luxand.deletePerson(fi.luxandId)));
    await this.prisma.faceImage.deleteMany({ where: { userId: id } });

    const uuids = await Promise.all(
      photos.map(p => this.luxand.enrollPerson(user.name, p.buffer, p.mimeType)),
    );
    await this.prisma.faceImage.createMany({
      data: uuids.map(luxandId => ({ userId: id, luxandId })),
    });

    return this.prisma.user.findFirst({
      where: { id },
      select: { id: true, name: true, email: true, faceImages: { select: { id: true } }, role: true, createdAt: true, updatedAt: true },
    });
  }

  getRoles(): string[] {
    return Object.values(Role);
  }
}
