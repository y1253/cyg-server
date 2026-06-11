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
var SchedulerService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const common_1 = require("@nestjs/common");
const schedule_1 = require("@nestjs/schedule");
const prisma_service_1 = require("../prisma/prisma.service");
const compute_next_due_1 = require("../task-schedules/compute-next-due");
let SchedulerService = SchedulerService_1 = class SchedulerService {
    prisma;
    logger = new common_1.Logger(SchedulerService_1.name);
    constructor(prisma) {
        this.prisma = prisma;
    }
    async createDueTodos() {
        this.logger.log('Daily todo generation job started');
        const schedules = await this.prisma.$queryRaw `
      SELECT id, taskId, companyId, cycle, cycleType, cycleDay, cycleNth, startDate
      FROM TaskSchedule
      WHERE deletedAt IS NULL
    `;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (const schedule of schedules) {
            await this.processSchedule(schedule, today);
        }
        this.logger.log(`Done. Processed ${schedules.length} schedules.`);
    }
    async processSchedule(schedule, today) {
        if (schedule.startDate) {
            const sd = new Date(schedule.startDate);
            sd.setHours(0, 0, 0, 0);
            if (sd > today)
                return;
        }
        const sfd = {
            cycle: schedule.cycle,
            cycleType: schedule.cycleType,
            cycleDay: schedule.cycleDay,
            cycleNth: schedule.cycleNth,
        };
        const latest = await this.prisma.todo.findFirst({
            where: { scheduleId: schedule.id },
            orderBy: { dueDate: 'desc' },
            select: { dueDate: true },
        });
        const base = schedule.startDate ? new Date(schedule.startDate) : today;
        let nextDue = latest?.dueDate
            ? (0, compute_next_due_1.computeNextDue)(new Date(latest.dueDate), sfd)
            : (0, compute_next_due_1.computeFirstDue)(base, sfd);
        while (nextDue <= today) {
            await this.prisma.todo.create({
                data: {
                    taskId: schedule.taskId,
                    companyId: schedule.companyId,
                    scheduleId: schedule.id,
                    dueDate: nextDue,
                },
            });
            nextDue = (0, compute_next_due_1.computeNextDue)(nextDue, sfd);
        }
    }
};
exports.SchedulerService = SchedulerService;
__decorate([
    (0, schedule_1.Cron)(schedule_1.CronExpression.EVERY_DAY_AT_MIDNIGHT),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SchedulerService.prototype, "createDueTodos", null);
exports.SchedulerService = SchedulerService = SchedulerService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SchedulerService);
//# sourceMappingURL=scheduler.service.js.map