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
exports.TodosService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
let TodosService = class TodosService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async toggleResolve(id, userId, userRole) {
        const todo = await this.prisma.todo.findUnique({
            where: { id },
            include: {
                company: {
                    include: { assignments: { select: { userId: true } } },
                },
            },
        });
        if (!todo)
            throw new common_1.NotFoundException('Todo not found');
        if (userRole !== 'ADMIN') {
            const assigned = todo.company.assignments.some(a => a.userId === userId);
            if (!assigned)
                throw new common_1.ForbiddenException('Not assigned to this company');
        }
        const newResolved = !todo.resolved;
        const updated = await this.prisma.todo.update({
            where: { id },
            data: {
                resolved: newResolved,
                resolvedAt: newResolved ? new Date() : null,
            },
        });
        return {
            id: updated.id,
            resolved: updated.resolved,
            resolvedAt: updated.resolvedAt,
        };
    }
};
exports.TodosService = TodosService;
exports.TodosService = TodosService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], TodosService);
//# sourceMappingURL=todos.service.js.map