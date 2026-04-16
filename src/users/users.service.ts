import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return users.map(({ password: _pw, ...rest }) => rest);
  }

  async findOne(id: number) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: {
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
                _count: { select: { todos: { where: { resolved: false } } } },
              },
            },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { password: _pw, assignments, ...rest } = user;
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

    const hashed = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.user.create({
      data: { name: dto.name, email: dto.email, password: hashed, role: dto.role },
    });
    const { password: _pw, ...rest } = user;
    return rest;
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
    if (dto.password !== undefined) data.password = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.update({ where: { id }, data });
    const { password: _pw, ...rest } = user;
    return rest;
  }

  async remove(id: number) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) throw new NotFoundException('User not found');
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id };
  }

  getRoles(): string[] {
    return Object.values(Role);
  }
}
