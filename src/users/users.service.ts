import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { ensureInternalWorkspace } from '../companies/internal-workspace.js';

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
      select: {
        id: true,
        name: true,
        email: true,
        faceImages: { select: { id: true } },
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * Minimal staff list for the internal-messaging recipient autocomplete.
   * Excludes the caller — you cannot address a message to yourself.
   */
  async findDirectory(excludeUserId: number) {
    return this.prisma.user.findMany({
      where: { deletedAt: null, id: { not: excludeUserId } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
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
                        OR: [
                          { dueDate: null },
                          { dueDate: { lte: startOfToday } },
                        ],
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
        .filter((a) => !a.company.deletedAt)
        .map((a) => ({
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
    const existing = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: null },
    });
    if (existing) throw new ConflictException('Email already in use');

    const select = {
      id: true,
      name: true,
      email: true,
      faceImages: { select: { id: true } },
      role: true,
      createdAt: true,
      updatedAt: true,
    } as const;

    const deleted = await this.prisma.user.findFirst({
      where: { email: dto.email, deletedAt: { not: null } },
    });

    // Every user — admin or not — gets their private "Cyg Finance" workspace, in
    // the SAME transaction as the user row so a user can never exist without one.
    return this.prisma.$transaction(async (tx) => {
      const user = deleted
        ? await tx.user.update({
            where: { id: deleted.id },
            data: { name: dto.name, role: dto.role, deletedAt: null },
            select,
          })
        : await tx.user.create({
            data: { name: dto.name, email: dto.email, role: dto.role },
            select,
          });

      await ensureInternalWorkspace(tx, user.id);
      return user;
    });
  }

  async update(id: number, dto: UpdateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt)
      throw new NotFoundException('User not found');

    if (dto.email && dto.email !== existing.email) {
      const conflict = await this.prisma.user.findUnique({
        where: { email: dto.email },
      });
      if (conflict) throw new ConflictException('Email already in use');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.role !== undefined) data.role = dto.role;

    return this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        faceImages: { select: { id: true } },
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { faceImages: true },
    });
    if (!existing || existing.deletedAt)
      throw new NotFoundException('User not found');
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    // Soft-delete their internal workspace too so it can't linger in company
    // queries. ensureInternalWorkspace un-deletes it if the user is ever restored.
    await this.prisma.company.updateMany({
      where: { internalOwnerId: id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    await Promise.allSettled(
      existing.faceImages.map((fi) => this.luxand.deletePerson(fi.luxandId)),
    );
    await this.prisma.faceImage.deleteMany({ where: { userId: id } });
    return { id };
  }

  async enrollFace(id: number, photos: { buffer: Buffer; mimeType: string }[]) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { faceImages: true },
    });
    if (!user) throw new NotFoundException('User not found');

    await Promise.allSettled(
      user.faceImages.map((fi) => this.luxand.deletePerson(fi.luxandId)),
    );
    await this.prisma.faceImage.deleteMany({ where: { userId: id } });

    const DUPLICATE_THRESHOLD = 0.95;
    const sessionIds: string[] = [];

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];

      if (sessionIds.length > 0) {
        try {
          const match = await this.luxand.searchFace(
            photo.buffer,
            photo.mimeType,
            { minConfidence: DUPLICATE_THRESHOLD },
          );
          if (match && sessionIds.includes(match.uuid)) {
            await Promise.allSettled(
              sessionIds.map((sid) => this.luxand.deletePerson(sid)),
            );
            throw new BadRequestException(
              `Photo ${i + 1} looks too similar to a previous photo. Try a different angle or lighting.`,
            );
          }
        } catch (err) {
          if (err instanceof BadRequestException) throw err;
          // Similarity check failed — proceed anyway
        }
      }

      const luxandId = await this.luxand.enrollPerson(
        user.name,
        photo.buffer,
        photo.mimeType,
      );
      sessionIds.push(luxandId);
    }

    await this.prisma.faceImage.createMany({
      data: sessionIds.map((luxandId) => ({ userId: id, luxandId })),
    });

    return this.prisma.user.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        faceImages: { select: { id: true } },
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  getRoles(): string[] {
    return Object.values(Role);
  }
}
