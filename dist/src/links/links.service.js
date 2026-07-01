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
const crypto_js_1 = require("../common/crypto.js");
let LinksService = class LinksService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async create(dto) {
        const encKey = process.env.ENCRYPTION_KEY;
        const { password, ...rest } = dto;
        const link = await this.prisma.link.create({
            data: {
                ...rest,
                password: password && encKey ? (0, crypto_js_1.encrypt)(password, encKey) : null,
            },
        });
        return this.decryptLink(link);
    }
    async update(id, dto) {
        const link = await this.prisma.link.findUnique({ where: { id } });
        if (!link)
            throw new common_1.NotFoundException('Link not found');
        const encKey = process.env.ENCRYPTION_KEY;
        const { password, ...rest } = dto;
        const data = { ...rest };
        if (password !== undefined) {
            data.password = password && encKey ? (0, crypto_js_1.encrypt)(password, encKey) : null;
        }
        const updated = await this.prisma.link.update({ where: { id }, data });
        return this.decryptLink(updated);
    }
    async remove(id) {
        const link = await this.prisma.link.findUnique({ where: { id } });
        if (!link)
            throw new common_1.NotFoundException('Link not found');
        await this.prisma.link.delete({ where: { id } });
    }
    async findByCompany(companyId) {
        const links = await this.prisma.link.findMany({ where: { companyId } });
        return links.map((link) => this.decryptLink(link));
    }
    decryptLink(link) {
        const encKey = process.env.ENCRYPTION_KEY;
        let password = null;
        if (link.password && encKey) {
            try {
                password = (0, crypto_js_1.decrypt)(link.password, encKey);
            }
            catch {
                password = null;
            }
        }
        return { ...link, password };
    }
};
exports.LinksService = LinksService;
exports.LinksService = LinksService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], LinksService);
//# sourceMappingURL=links.service.js.map