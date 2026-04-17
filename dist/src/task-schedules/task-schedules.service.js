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
let TaskSchedulesService = class TaskSchedulesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const existing = await this.prisma.taskSchedule.findFirst({
            where: { taskId: dto.taskId, companyId: dto.companyId, deletedAt: null },
        });
        if (existing) {
            throw new common_1.ConflictException('A schedule for this task and company already exists');
        }
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + dto.cycle);
        const schedule = await this.prisma.taskSchedule.create({
            data: {
                taskId: dto.taskId,
                companyId: dto.companyId,
                cycle: dto.cycle,
                note: dto.note,
                todos: {
                    create: {
                        taskId: dto.taskId,
                        companyId: dto.companyId,
                        dueDate,
                    },
                },
            },
            include: { task: { select: { id: true, title: true } } },
        });
        return schedule;
    }
    async findByCompany(companyId) {
        return this.prisma.taskSchedule.findMany({
            where: { companyId, deletedAt: null },
            include: { task: { select: { id: true, title: true, description: true } } },
            orderBy: { createdAt: 'asc' },
        });
    }
    async update(id, dto) {
        const schedule = await this.prisma.taskSchedule.findFirst({
            where: { id, deletedAt: null },
        });
        if (!schedule)
            throw new common_1.NotFoundException('Schedule not found');
        return this.prisma.taskSchedule.update({
            where: { id },
            data: { cycle: dto.cycle, note: dto.note },
            include: { task: { select: { id: true, title: true } } },
        });
    }
    async remove(id) {
        const schedule = await this.prisma.taskSchedule.findFirst({
            where: { id, deletedAt: null },
        });
        if (!schedule)
            throw new common_1.NotFoundException('Schedule not found');
        await this.prisma.taskSchedule.update({
            where: { id },
            data: { deletedAt: new Date() },
        });
    }
};
exports.TaskSchedulesService = TaskSchedulesService;
exports.TaskSchedulesService = TaskSchedulesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], TaskSchedulesService);
//# sourceMappingURL=task-schedules.service.js.map