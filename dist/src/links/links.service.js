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
exports.LinksService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_js_1 = require("../prisma/prisma.service.js");
let LinksService = class LinksService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        return this.prisma.link.create({ data: dto });
    }
    async update(id, dto) {
        const link = await this.prisma.link.findUnique({ where: { id } });
        if (!link)
            throw new common_1.NotFoundException('Link not found');
        return this.prisma.link.update({ where: { id }, data: dto });
    }
    async remove(id) {
        const link = await this.prisma.link.findUnique({ where: { id } });
        if (!link)
            throw new common_1.NotFoundException('Link not found');
        await this.prisma.link.delete({ where: { id } });
    }
    async findByCompany(companyId) {
        return this.prisma.link.findMany({ where: { companyId } });
    }
};
exports.LinksService = LinksService;
exports.LinksService = LinksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], LinksService);
//# sourceMappingURL=links.service.js.map