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
const compute_next_due_js_1 = require("../task-schedules/compute-next-due.js");
let TasksService = class TasksService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const tasks = await this.prisma.task.findMany({
            where: { deletedAt: null },
            include: {
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
            orderBy: { createdAt: 'desc' },
        });
        const cycleRows = await this.prisma.$queryRaw `
      SELECT id, defaultCycleType, defaultCycleDay, defaultCycleNth, orderNumber
      FROM Task WHERE deletedAt IS NULL
    `;
        const cycleMap = new Map(cycleRows.map((r) => [Number(r.id), r]));
        return tasks.map((t) => {
            const extra = cycleMap.get(t.id);
            return {
                id: t.id,
                title: t.title,
                description: t.description,
                note: t.note,
                isGeneral: t.isGeneral,
                defaultCycle: t.defaultCycle,
                defaultCycleType: extra?.defaultCycleType ?? 'DAYS',
                defaultCycleDay: extra?.defaultCycleDay ?? null,
                defaultCycleNth: extra?.defaultCycleNth ?? null,
                isImportant: t.isImportant,
                canBeDisabled: t.canBeDisabled,
                isSnoozable: t.isSnoozable,
                orderNumber: extra?.orderNumber ?? null,
                createdAt: t.createdAt,
                openTodos: t._count.todos,
            };
        });
    }
    async create(dto) {
        const existing = await this.prisma.task.findUnique({
            where: { title: dto.title },
        });
        if (existing && !existing.deletedAt) {
            throw new common_1.ConflictException('A task with this title already exists');
        }
        if (dto.orderNumber != null) {
            const orderConflict = await this.prisma.task.findFirst({
                where: { orderNumber: dto.orderNumber, deletedAt: null },
            });
            if (orderConflict) {
                throw new common_1.ConflictException('That order number is already assigned to another task');
            }
        }
        const task = await this.prisma.task.create({
            data: {
                title: dto.title,
                description: dto.description,
                isGeneral: true,
                defaultCycle: dto.defaultCycle ?? 30,
                isImportant: dto.isImportant ?? false,
                canBeDisabled: dto.canBeDisabled ?? false,
                isSnoozable: dto.isSnoozable ?? false,
                orderNumber: dto.orderNumber ?? null,
            },
        });
        const cycleType = dto.defaultCycleType ?? 'DAYS';
        const cycleDay = dto.defaultCycleDay ?? null;
        const cycleNth = dto.defaultCycleNth ?? null;
        await this.prisma.$executeRaw `
      UPDATE Task SET defaultCycleType = ${cycleType}, defaultCycleDay = ${cycleDay}, defaultCycleNth = ${cycleNth}
      WHERE id = ${task.id}
    `;
        const fullTask = {
            ...task,
            defaultCycleType: cycleType,
            defaultCycleDay: cycleDay,
            defaultCycleNth: cycleNth,
        };
        if (fullTask.isGeneral) {
            await this.createSchedulesForAllCompanies(fullTask);
        }
        return fullTask;
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
        if (dto.orderNumber != null) {
            const orderConflict = await this.prisma.task.findFirst({
                where: {
                    orderNumber: dto.orderNumber,
                    deletedAt: null,
                    id: { not: id },
                },
            });
            if (orderConflict) {
                throw new common_1.ConflictException('That order number is already assigned to another task');
            }
        }
        const updated = await this.prisma.task.update({
            where: { id },
            data: {
                title: dto.title,
                description: dto.description,
                defaultCycle: dto.defaultCycle,
                isImportant: dto.isImportant,
                canBeDisabled: dto.canBeDisabled,
                isSnoozable: dto.isSnoozable,
                ...(dto.orderNumber !== undefined
                    ? { orderNumber: dto.orderNumber }
                    : {}),
            },
        });
        if (dto.defaultCycleType !== undefined) {
            await this.prisma.$executeRaw `
        UPDATE Task SET defaultCycleType = ${dto.defaultCycleType}, defaultCycleDay = ${dto.defaultCycleDay ?? null}, defaultCycleNth = ${dto.defaultCycleNth ?? null}
        WHERE id = ${id}
      `;
        }
        const [cycleRow] = await this.prisma.$queryRaw `
      SELECT id, defaultCycleType, defaultCycleDay, defaultCycleNth FROM Task WHERE id = ${id}
    `;
        return {
            ...updated,
            defaultCycleType: cycleRow?.defaultCycleType ?? 'DAYS',
            defaultCycleDay: cycleRow?.defaultCycleDay ?? null,
            defaultCycleNth: cycleRow?.defaultCycleNth ?? null,
        };
    }
    async remove(id) {
        const task = await this.prisma.task.findFirst({
            where: { id, deletedAt: null },
        });
        if (!task)
            throw new common_1.NotFoundException('Task not found');
        await this.prisma.$transaction([
            this.prisma.todo.deleteMany({ where: { taskId: id } }),
            this.prisma.taskSchedule.deleteMany({ where: { taskId: id } }),
            this.prisma.task.delete({ where: { id } }),
        ]);
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
            const dueDate = dto.dueDate
                ? new Date(dto.dueDate)
                : (() => {
                    const d = new Date();
                    d.setDate(d.getDate() + dto.cycle);
                    return d;
                })();
            const schedule = await this.prisma.taskSchedule.create({
                data: {
                    taskId,
                    companyId: dto.companyId,
                    cycle: dto.cycle,
                    isImportant: task.isImportant,
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
    async createSchedulesForAllCompanies(task) {
        const companies = await this.prisma.company.findMany({
            where: { deletedAt: null },
            select: { id: true },
        });
        const existingSchedules = await this.prisma.taskSchedule.findMany({
            where: { taskId: task.id, deletedAt: null },
            select: { companyId: true },
        });
        const scheduledIds = new Set(existingSchedules.map((s) => s.companyId));
        for (const company of companies) {
            if (scheduledIds.has(company.id))
                continue;
            const dueDate = (0, compute_next_due_js_1.computeNextDue)(new Date(), {
                cycleType: task.defaultCycleType,
                cycle: task.defaultCycle,
                cycleDay: task.defaultCycleDay,
                cycleNth: task.defaultCycleNth,
            });
            const schedule = await this.prisma.taskSchedule.create({
                data: {
                    taskId: task.id,
                    companyId: company.id,
                    cycle: task.defaultCycle,
                    isImportant: task.isImportant,
                    todos: {
                        create: { taskId: task.id, companyId: company.id, dueDate },
                    },
                },
            });
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            await this.prisma.$executeRaw `
        UPDATE TaskSchedule SET cycleType = ${task.defaultCycleType}, cycleDay = ${task.defaultCycleDay ?? null}, cycleNth = ${task.defaultCycleNth ?? null}, startDate = ${today}
        WHERE id = ${schedule.id}
      `;
        }
    }
};
exports.TasksService = TasksService;
exports.TasksService = TasksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], TasksService);
//# sourceMappingURL=tasks.service.js.map