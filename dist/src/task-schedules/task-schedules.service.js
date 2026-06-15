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
exports.TaskSchedulesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const compute_next_due_1 = require("./compute-next-due");
let TaskSchedulesService = class TaskSchedulesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const task = await this.prisma.task.findUnique({ where: { id: dto.taskId } });
        const cycleType = dto.cycleType ?? 'DAYS';
        const cycle = dto.cycle ?? 30;
        const cycleDay = dto.cycleDay ?? null;
        const cycleNth = dto.cycleNth ?? null;
        const startDate = dto.startDate ? new Date(dto.startDate) : new Date();
        startDate.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let createTodo = false;
        let dueDate;
        if (!startDate || startDate <= today) {
            dueDate = (0, compute_next_due_1.computeFirstDue)(startDate ?? today, { cycleType, cycle, cycleDay, cycleNth });
            createTodo = dueDate.getTime() <= today.getTime();
        }
        const schedule = await this.prisma.taskSchedule.create({
            data: {
                taskId: dto.taskId,
                companyId: dto.companyId,
                cycle,
                note: dto.note,
                isImportant: task?.isImportant ?? false,
                ...(createTodo && dueDate ? { todos: { create: { taskId: dto.taskId, companyId: dto.companyId, dueDate } } } : {}),
            },
            include: { task: { select: { id: true, title: true } } },
        });
        await this.prisma.$executeRaw `
      UPDATE TaskSchedule SET cycleType = ${cycleType}, cycleDay = ${cycleDay}, cycleNth = ${cycleNth}, isManuallyAdded = 1, startDate = ${startDate}
      WHERE id = ${schedule.id}
    `;
        return { ...schedule, cycleType, cycleDay, cycleNth, startDate: startDate?.toISOString() ?? null, isManuallyAdded: true };
    }
    async findByCompany(companyId) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const schedules = await this.prisma.taskSchedule.findMany({
            where: { companyId },
            include: {
                task: { select: { id: true, title: true, description: true, canBeDisabled: true, orderNumber: true } },
                todos: {
                    orderBy: { dueDate: 'desc' },
                    take: 1,
                    select: { dueDate: true },
                },
            },
            orderBy: [{ deletedAt: 'asc' }, { createdAt: 'asc' }],
        });
        if (schedules.length === 0)
            return schedules;
        const cycleRows = await this.prisma.$queryRaw `
      SELECT id, cycleType, cycleDay, cycleNth, startDate, userNote, isManuallyAdded FROM TaskSchedule WHERE companyId = ${companyId}
    `;
        const cycleMap = new Map(cycleRows.map(r => [Number(r.id), r]));
        return schedules.map(({ todos, ...s }) => {
            const row = cycleMap.get(s.id);
            const cycleArgs = {
                cycle: s.cycle,
                cycleType: row?.cycleType ?? 'DAYS',
                cycleDay: row?.cycleDay ?? null,
                cycleNth: row?.cycleNth ?? null,
            };
            const base = row?.startDate ? new Date(row.startDate) : startOfToday;
            const latestDate = todos[0]?.dueDate ? new Date(todos[0].dueDate) : null;
            const nextTodoDate = latestDate
                ? latestDate > startOfToday
                    ? latestDate.toISOString()
                    : (0, compute_next_due_1.computeNextDue)(latestDate, cycleArgs).toISOString()
                : (0, compute_next_due_1.computeFirstDue)(base, cycleArgs).toISOString();
            return {
                ...s,
                cycleType: cycleArgs.cycleType,
                cycleDay: cycleArgs.cycleDay,
                cycleNth: cycleArgs.cycleNth,
                startDate: row?.startDate?.toISOString() ?? null,
                userNote: row?.userNote ?? null,
                isManuallyAdded: Boolean(row?.isManuallyAdded),
                nextTodoDate,
            };
        });
    }
    async update(id, dto) {
        const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
        if (!schedule)
            throw new common_1.NotFoundException('Schedule not found');
        const updated = await this.prisma.taskSchedule.update({
            where: { id },
            data: {
                cycle: dto.cycle,
                note: dto.note,
            },
            include: { task: { select: { id: true, title: true } } },
        });
        if (dto.cycleType !== undefined) {
            await this.prisma.$executeRaw `
        UPDATE TaskSchedule SET cycleType = ${dto.cycleType}, cycleDay = ${dto.cycleDay ?? null}, cycleNth = ${dto.cycleNth ?? null}
        WHERE id = ${id}
      `;
        }
        const cycleChanged = (dto.cycle !== undefined || dto.cycleType !== undefined) && dto.startDate === undefined;
        if (cycleChanged) {
            const todayMidnight = new Date();
            todayMidnight.setHours(0, 0, 0, 0);
            await this.prisma.todo.deleteMany({
                where: { scheduleId: id, resolved: false, dueDate: { gt: todayMidnight } },
            });
            const unresolvedCount = await this.prisma.todo.count({
                where: { scheduleId: id, resolved: false },
            });
            if (!unresolvedCount) {
                const [freshRow] = await this.prisma.$queryRaw `
          SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
        `;
                const newArgs = {
                    cycle: updated.cycle,
                    cycleType: freshRow?.cycleType ?? 'DAYS',
                    cycleDay: freshRow?.cycleDay ?? null,
                    cycleNth: freshRow?.cycleNth ?? null,
                };
                const firstDue = (0, compute_next_due_1.computeFirstDue)(todayMidnight, newArgs);
                if (firstDue.getTime() === todayMidnight.getTime()) {
                    await this.prisma.todo.create({
                        data: { taskId: schedule.taskId, companyId: schedule.companyId, scheduleId: id, dueDate: todayMidnight },
                    });
                }
            }
        }
        if (dto.startDate !== undefined) {
            const sd = dto.startDate ? new Date(dto.startDate) : null;
            await this.prisma.$executeRaw `
        UPDATE TaskSchedule SET startDate = ${sd} WHERE id = ${id}
      `;
            if (sd) {
                await this.prisma.todo.deleteMany({ where: { scheduleId: id, resolved: false } });
                const [cycleRow] = await this.prisma.$queryRaw `
          SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
        `;
                const scheduleArgs = {
                    cycle: updated.cycle,
                    cycleType: cycleRow?.cycleType ?? 'DAYS',
                    cycleDay: cycleRow?.cycleDay ?? null,
                    cycleNth: cycleRow?.cycleNth ?? null,
                };
                const todayStr = new Date().toISOString().slice(0, 10);
                const sdStr = sd.toISOString().slice(0, 10);
                if (sdStr <= todayStr) {
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    let nextDue = (0, compute_next_due_1.computeFirstDue)(sd, scheduleArgs);
                    while (nextDue <= today) {
                        await this.prisma.todo.create({
                            data: { taskId: schedule.taskId, companyId: schedule.companyId, scheduleId: id, dueDate: nextDue },
                        });
                        nextDue = (0, compute_next_due_1.computeNextDue)(nextDue, scheduleArgs);
                    }
                    await this.prisma.todo.create({
                        data: { taskId: schedule.taskId, companyId: schedule.companyId, scheduleId: id, dueDate: nextDue },
                    });
                }
            }
        }
        const [cycleRow] = await this.prisma.$queryRaw `
      SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
    `;
        const latestTodo = await this.prisma.todo.findFirst({
            where: { scheduleId: id },
            orderBy: { dueDate: 'desc' },
            select: { dueDate: true },
        });
        const cycleArgsForNext = {
            cycle: updated.cycle,
            cycleType: cycleRow?.cycleType ?? 'DAYS',
            cycleDay: cycleRow?.cycleDay ?? null,
            cycleNth: cycleRow?.cycleNth ?? null,
        };
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const base = cycleRow?.startDate ? new Date(cycleRow.startDate) : startOfToday;
        const latestDate = latestTodo?.dueDate ? new Date(latestTodo.dueDate) : null;
        const nextTodoDate = latestDate
            ? latestDate > startOfToday
                ? latestDate.toISOString()
                : (0, compute_next_due_1.computeNextDue)(latestDate, cycleArgsForNext).toISOString()
            : (0, compute_next_due_1.computeFirstDue)(base, cycleArgsForNext).toISOString();
        return {
            ...updated,
            cycleType: cycleRow?.cycleType ?? 'DAYS',
            cycleDay: cycleRow?.cycleDay ?? null,
            cycleNth: cycleRow?.cycleNth ?? null,
            startDate: cycleRow?.startDate?.toISOString() ?? null,
            nextTodoDate,
        };
    }
    async toggle(id) {
        const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
        if (!schedule)
            throw new common_1.NotFoundException('Schedule not found');
        const updated = await this.prisma.taskSchedule.update({
            where: { id },
            data: { deletedAt: schedule.deletedAt ? null : new Date() },
            include: { task: { select: { id: true, title: true, description: true, canBeDisabled: true } } },
        });
        const [cycleRow] = await this.prisma.$queryRaw `
      SELECT id, cycleType, cycleDay, cycleNth, startDate FROM TaskSchedule WHERE id = ${id}
    `;
        return {
            ...updated,
            cycleType: cycleRow?.cycleType ?? 'DAYS',
            cycleDay: cycleRow?.cycleDay ?? null,
            cycleNth: cycleRow?.cycleNth ?? null,
            startDate: cycleRow?.startDate?.toISOString() ?? null,
        };
    }
    async toggleImportant(id) {
        const schedule = await this.prisma.taskSchedule.findUnique({ where: { id } });
        if (!schedule)
            throw new common_1.NotFoundException('Schedule not found');
        return this.prisma.taskSchedule.update({
            where: { id },
            data: { isImportant: !schedule.isImportant },
            select: { id: true, isImportant: true },
        });
    }
    async updateUserNote(id, note) {
        await this.prisma.$executeRaw `
      UPDATE TaskSchedule SET userNote = ${note ?? null} WHERE id = ${id}
    `;
    }
    async deleteSchedule(id) {
        const schedule = await this.prisma.taskSchedule.findFirst({ where: { id } });
        if (!schedule)
            throw new common_1.NotFoundException('Schedule not found');
        await this.prisma.todo.deleteMany({ where: { scheduleId: id, resolved: false } });
        await this.prisma.taskSchedule.delete({ where: { id } });
    }
};
exports.TaskSchedulesService = TaskSchedulesService;
exports.TaskSchedulesService = TaskSchedulesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TaskSchedulesService);
//# sourceMappingURL=task-schedules.service.js.map