"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UsersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const luxand_service_js_1 = require("../luxand/luxand.service.js");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const internal_workspace_js_1 = require("../companies/internal-workspace.js");
let UsersService = class UsersService {
    static { UsersService_1 = this; }
    prisma;
    luxand;
    logger = new common_1.Logger(UsersService_1.name);
    constructor(prisma, luxand) {
        this.prisma = prisma;
        this.luxand = luxand;
    }
    static FACE_SELECT = {
        select: { createdAt: true },
    };
    static withFaceFlags(row) {
        const { faceSubject, ...rest } = row;
        return {
            ...rest,
            faceEnrolled: Boolean(faceSubject),
            faceEnrolledAt: faceSubject?.createdAt ?? null,
            faceImages: faceSubject ? [{ id: 1 }] : [],
        };
    }
    findByEmail(email) {
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
                faceSubject: UsersService_1.FACE_SELECT,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return users.map((u) => UsersService_1.withFaceFlags(u));
    }
    async findDirectory(excludeUserId) {
        return this.prisma.user.findMany({
            where: { deletedAt: null, id: { not: excludeUserId } },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, email: true },
        });
    }
    async findOne(id) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const user = await this.prisma.user.findFirst({
            where: { id, deletedAt: null },
            include: {
                faceSubject: UsersService_1.FACE_SELECT,
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
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const { assignments, ...rest } = user;
        return {
            ...UsersService_1.withFaceFlags(rest),
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
    async create(dto) {
        const existing = await this.prisma.user.findFirst({
            where: { email: dto.email, deletedAt: null },
        });
        if (existing)
            throw new common_1.ConflictException('Email already in use');
        const select = {
            id: true,
            name: true,
            email: true,
            faceSubject: UsersService_1.FACE_SELECT,
            role: true,
            createdAt: true,
            updatedAt: true,
        };
        const deleted = await this.prisma.user.findFirst({
            where: { email: dto.email, deletedAt: { not: null } },
        });
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
            await (0, internal_workspace_js_1.ensureInternalWorkspace)(tx, user.id);
            return UsersService_1.withFaceFlags(user);
        });
    }
    async update(id, dto) {
        const existing = await this.prisma.user.findUnique({ where: { id } });
        if (!existing || existing.deletedAt)
            throw new common_1.NotFoundException('User not found');
        if (dto.email && dto.email !== existing.email) {
            const conflict = await this.prisma.user.findUnique({
                where: { email: dto.email },
            });
            if (conflict)
                throw new common_1.ConflictException('Email already in use');
        }
        const data = {};
        if (dto.name !== undefined)
            data.name = dto.name;
        if (dto.email !== undefined)
            data.email = dto.email;
        if (dto.role !== undefined)
            data.role = dto.role;
        const updated = await this.prisma.user.update({
            where: { id },
            data,
            select: {
                id: true,
                name: true,
                email: true,
                faceSubject: UsersService_1.FACE_SELECT,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return UsersService_1.withFaceFlags(updated);
    }
    async remove(id) {
        const existing = await this.prisma.user.findUnique({
            where: { id },
            include: { faceSubject: { select: { subjectId: true } } },
        });
        if (!existing || existing.deletedAt)
            throw new common_1.NotFoundException('User not found');
        await this.prisma.user.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        await this.prisma.company.updateMany({
            where: { internalOwnerId: id, deletedAt: null },
            data: { deletedAt: new Date() },
        });
        if (existing.faceSubject) {
            const { subjectId } = existing.faceSubject;
            void this.luxand
                .deletePerson(subjectId)
                .catch((e) => this.logger.warn(`orphan luxand subject ${subjectId} for user ${id}: ${String(e)}`));
        }
        await this.prisma.faceSubject.deleteMany({ where: { userId: id } });
        return { id };
    }
    async enrollFace(id, photos) {
        const started = Date.now();
        const user = await this.prisma.user.findFirst({
            where: { id, deletedAt: null },
            select: {
                id: true,
                name: true,
                faceSubject: { select: { subjectId: true } },
            },
        });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        const oldSubjectId = user.faceSubject?.subjectId ?? null;
        const subjectId = await this.luxand.createPerson(`${user.name} (#${user.id})`, photos);
        try {
            await this.prisma.faceSubject.upsert({
                where: { userId: id },
                create: { userId: id, subjectId },
                update: { subjectId },
            });
        }
        catch (err) {
            await this.luxand.deletePerson(subjectId).catch(() => undefined);
            throw err;
        }
        if (oldSubjectId && oldSubjectId !== subjectId) {
            void this.luxand
                .deletePerson(oldSubjectId)
                .catch((e) => this.logger.warn(`orphan luxand subject ${oldSubjectId} for user ${id}: ${String(e)}`));
        }
        this.logger.log(`enrollFace #${id} old=${oldSubjectId ?? '-'} new=${subjectId} ${Date.now() - started}ms`);
        const row = await this.prisma.user.findFirstOrThrow({
            where: { id },
            select: {
                id: true,
                name: true,
                email: true,
                faceSubject: UsersService_1.FACE_SELECT,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
        });
        return UsersService_1.withFaceFlags(row);
    }
    getRoles() {
        return Object.values(client_1.Role);
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = UsersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService,
        luxand_service_js_1.LuxandService])
], UsersService);
//# sourceMappingURL=users.service.js.map