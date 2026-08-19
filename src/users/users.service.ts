import {
  ConflictException,
  Injectable,
  Logger,
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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private luxand: LuxandService,
  ) {}

  /**
   * What a user projection selects about face enrolment.
   *
   * Deliberately only `createdAt`: the Luxand `subjectId` is a credential-adjacent
   * handle the client has no use for, and the surest way not to leak it is never
   * to put it in a projection that reaches a controller.
   */
  private static readonly FACE_SELECT = {
    select: { createdAt: true },
  } as const;

  /**
   * Collapse the relation into the flags the client actually renders.
   *
   * `faceImages` is a compatibility shim for the older client build, which checks
   * `faceImages.length > 0`. It lets the server deploy ahead of the client instead
   * of forcing one coordinated cutover; drop it once the client is updated.
   */
  private static withFaceFlags<
    T extends { faceSubject: { createdAt: Date } | null },
  >(row: T) {
    const { faceSubject, ...rest } = row;
    return {
      ...rest,
      faceEnrolled: Boolean(faceSubject),
      faceEnrolledAt: faceSubject?.createdAt ?? null,
      faceImages: faceSubject ? [{ id: 1 }] : [],
    };
  }

  /** Auth hot path: select explicitly rather than `include`, which pulls every column. */
  findByEmail(email: string) {
    return this.prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        faceSubject: { select: { subjectId: true } },
      },
    });
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        faceSubject: UsersService.FACE_SELECT,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return users.map((u) => UsersService.withFaceFlags(u));
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
        faceSubject: UsersService.FACE_SELECT,
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
      ...UsersService.withFaceFlags(rest),
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
      faceSubject: UsersService.FACE_SELECT,
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
      return UsersService.withFaceFlags(user);
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

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        faceSubject: UsersService.FACE_SELECT,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return UsersService.withFaceFlags(updated);
  }

  async remove(id: number) {
    const existing = await this.prisma.user.findUnique({
      where: { id },
      include: { faceSubject: { select: { subjectId: true } } },
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
    // Drop the row, not just the remote identity: both userId and subjectId are
    // unique, so a soft-deleted user holding a stale row would block reuse of
    // either value. A restored user re-enrols anyway.
    if (existing.faceSubject) {
      const { subjectId } = existing.faceSubject;
      void this.luxand
        .deletePerson(subjectId)
        .catch((e: unknown) =>
          this.logger.warn(
            `orphan luxand subject ${subjectId} for user ${id}: ${String(e)}`,
          ),
        );
    }
    await this.prisma.faceSubject.deleteMany({ where: { userId: id } });
    return { id };
  }

  /**
   * Replace a user's face enrolment with a single Luxand person holding all three
   * photos.
   *
   * Ordering matters and is the fix for a real lockout bug: the previous version
   * deleted the old subjects and rows *before* creating anything, so a failure on
   * photo 2 of 3 left the user with no enrolment at all and no way back in. Here
   * nothing is destroyed until the replacement exists.
   *
   * The old per-photo similarity check is gone. It cost two extra round-trips, its
   * errors were swallowed so it silently did nothing whenever the search failed,
   * and it could not work reliably anyway (the search returned only the global
   * top-1). It also no longer has a purpose: three photos now live inside one
   * person, where near-duplicates are harmless rather than three competing
   * identities in a shared gallery. Pose variety is enforced in the browser, which
   * can tell the user to turn their head while they can still act on it.
   */
  async enrollFace(id: number, photos: { buffer: Buffer; mimeType: string }[]) {
    const started = Date.now();

    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        faceSubject: { select: { subjectId: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const oldSubjectId = user.faceSubject?.subjectId ?? null;

    // 1. Create first. If this throws, the existing enrolment is still intact.
    //    The id suffix keeps two colleagues named "David" distinguishable in the
    //    Luxand console, which is where you look when something goes wrong.
    const subjectId = await this.luxand.createPerson(
      `${user.name} (#${user.id})`,
      photos,
    );

    // 2. Commit. upsert on the unique userId, so re-enrolling overwrites in place
    //    rather than accumulating rows.
    try {
      await this.prisma.faceSubject.upsert({
        where: { userId: id },
        create: { userId: id, subjectId },
        update: { subjectId },
      });
    } catch (err) {
      // Do not leave the person we just created stranded in the gallery.
      await this.luxand.deletePerson(subjectId).catch(() => undefined);
      throw err;
    }

    // 3. Only now retire the previous identity. A failed cleanup must not fail an
    //    otherwise successful enrolment.
    if (oldSubjectId && oldSubjectId !== subjectId) {
      void this.luxand
        .deletePerson(oldSubjectId)
        .catch((e: unknown) =>
          this.logger.warn(
            `orphan luxand subject ${oldSubjectId} for user ${id}: ${String(e)}`,
          ),
        );
    }

    this.logger.log(
      `enrollFace #${id} old=${oldSubjectId ?? '-'} new=${subjectId} ${Date.now() - started}ms`,
    );

    const row = await this.prisma.user.findFirstOrThrow({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        faceSubject: UsersService.FACE_SELECT,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return UsersService.withFaceFlags(row);
  }

  getRoles(): string[] {
    return Object.values(Role);
  }
}
