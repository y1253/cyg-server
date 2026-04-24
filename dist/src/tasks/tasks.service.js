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
Object.defineProperty(exports, "__esModule", { value: true });
exports.TasksService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
let TasksService = class TasksService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        const tasks = await this.prisma.task.findMany({
            where: { deletedAt: null },
            include: {
                _count: {
                    select: {
                        todos: {
                            where: {
                                resolved: false,
                                OR: [{ startDate: null }, { startDate: { lte: new Date() } }],
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return tasks.map(t => ({
            id: t.id,
            title: t.title,
            description: t.description,
            note: t.note,
            isGeneral: t.isGeneral,
            createdAt: t.createdAt,
            openTodos: t._count.todos,
        }));
    }
    async create(dto) {
        const existing = await this.prisma.task.findUnique({
            where: { title: dto.title },
        });
        if (existing && !existing.deletedAt) {
            throw new common_1.ConflictException('A task with this title already exists');
        }
        const task = await this.prisma.task.create({
            data: {
                title: dto.title,
                description: dto.description,
                note: dto.note,
                isGeneral: dto.isGeneral ?? false,
            },
        });
        if (task.isGeneral) {
            await this.createSchedulesForAllCompanies(task.id);
        }
        return task;
    }
    async update(id, dto) {
        const task = await this.prisma.task.findFirst({
            where: { id, deletedAt: null },
        });
        if (!task)
            throw new common_1.NotFoundException('Task not found');
        if (dto.title && dto.title !== task.title) {
            const conflict = await this.prisma.task.findUnique({
                where: { title: dto.title },
            });
            if (conflict && !conflict.deletedAt && conflict.id !== id) {
                throw new common_1.ConflictException('A task with this title already exists');
            }
        }
        const wasGeneral = task.isGeneral;
        const updated = await this.prisma.task.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                note: dto.note,
                isGeneral: dto.isGeneral,
            },
        });
        if (!wasGeneral && updated.isGeneral) {
            await this.createSchedulesForAllCompanies(id);
        }
        return updated;
    }
    async remove(id) {
        const task = await this.prisma.task.findFirst({
            where: { id, deletedAt: null },
        });
        if (!task)
            throw new common_1.NotFoundException('Task not found');
        await this.prisma.task.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
        return { id };
    }
    async assignToCompany(taskId, dto) {
        const task = await this.prisma.task.findFirst({
            where: { id: taskId, deletedAt: null },
        });
        if (!task)
            throw new common_1.NotFoundException('Task not found');
        const company = await this.prisma.company.findFirst({
            where: { id: dto.companyId, deletedAt: null },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        if (dto.cycle) {
            const existing = await this.prisma.taskSchedule.findFirst({
                where: { taskId, companyId: dto.companyId, deletedAt: null },
            });
            if (existing) {
                throw new common_1.ConflictException('A schedule for this task and company already exists');
            }
            const dueDate = dto.dueDate
                ? new Date(dto.dueDate)
                : (() => { const d = new Date(); d.setDate(d.getDate() + dto.cycle); return d; })();
            const schedule = await this.prisma.taskSchedule.create({
                data: {
                    taskId,
                    companyId: dto.companyId,
                    cycle: dto.cycle,
                    todos: {
                        create: { taskId, companyId: dto.companyId, dueDate },
                    },
                },
            });
            return schedule;
        }
        else {
            const todo = await this.prisma.todo.create({
                data: {
                    taskId,
                    companyId: dto.companyId,
                    dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
                },
            });
            return todo;
        }
    }
    async createSchedulesForAllCompanies(taskId) {
        const companies = await this.prisma.company.findMany({
            where: { deletedAt: null },
            select: { id: true },
        });
        const existingSchedules = await this.prisma.taskSchedule.findMany({
            where: { taskId, deletedAt: null },
            select: { companyId: true },
        });
        const scheduledIds = new Set(existingSchedules.map(s => s.companyId));
        const CYCLE = 30;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + CYCLE);
        for (const company of companies) {
            if (scheduledIds.has(company.id))
                continue;
            await this.prisma.taskSchedule.create({
                data: {
                    taskId,
                    companyId: company.id,
                    cycle: CYCLE,
                    todos: {
                        create: { taskId, companyId: company.id, dueDate },
                    },
                },
            });
        }
    }
};
exports.TasksService = TasksService;
exports.TasksService = TasksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], TasksService);
//# sourceMappingURL=tasks.service.js.map