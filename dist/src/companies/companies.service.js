"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompaniesService = void 0;
const common_1 = require("@nestjs/common");
const crypto = __importStar(require("crypto"));
const prisma_service_js_1 = require("../prisma/prisma.service.js");
const ALGORITHM = 'aes-256-cbc';
function encrypt(text, keyHex) {
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}
let CompaniesService = class CompaniesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async register(dto) {
        const encKey = process.env.ENCRYPTION_KEY;
        if (!encKey)
            throw new Error('ENCRYPTION_KEY not set');
        const qbTaskTitle = dto.hasQbAccount
            ? 'Follow up: Verify QuickBooks invite sent'
            : `Open QuickBooks Online ${dto.qbPlan}`;
        const qbTask = await this.prisma.task.findUnique({ where: { title: qbTaskTitle } });
        if (!qbTask) {
            throw new common_1.BadRequestException(`QB task not found: "${qbTaskTitle}". Run the seed first.`);
        }
        const hasContact = dto.personalName || dto.privateEmail || dto.privatePhone || dto.storeNumber;
        const hasLegal = dto.country === 'CANADA' && (dto.neq || dto.revenueQcId || dto.craBn || dto.fiscalYear);
        const hasBilling = !!dto.billingEmail;
        const hasAccountant = !!dto.accountantName;
        const encryptedBillingPassword = hasBilling && dto.billingPassword ? encrypt(dto.billingPassword, encKey) : undefined;
        const company = await this.prisma.company.create({
            data: {
                businessName: dto.businessName,
                businessType: dto.businessType,
                companyType: dto.companyType,
                companyActivity: dto.companyActivity,
                country: dto.country,
                qbPlan: dto.hasQbAccount ? 'HAS_ACCOUNT' : dto.qbPlan,
                ...(hasContact && {
                    contactInfo: {
                        create: {
                            personalName: dto.personalName,
                            privateEmail: dto.privateEmail,
                            privatePhone: dto.privatePhone,
                            storeNumber: dto.storeNumber,
                        },
                    },
                }),
                ...(hasLegal && {
                    legalInfo: {
                        create: {
                            neq: dto.neq,
                            revenueQcId: dto.revenueQcId,
                            craBn: dto.craBn,
                            fiscalYear: dto.fiscalYear,
                        },
                    },
                }),
                ...(hasBilling && {
                    billing: {
                        create: {
                            billingEmail: dto.billingEmail,
                            billingPassword: encryptedBillingPassword,
                        },
                    },
                }),
                ...(hasAccountant && {
                    accountant: {
                        create: {
                            name: dto.accountantName,
                            email: dto.accountantEmail,
                            phone: dto.accountantPhone,
                        },
                    },
                }),
            },
        });
        const dueDate = dto.hasQbAccount
            ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
            : null;
        await this.prisma.todo.create({
            data: {
                taskId: qbTask.id,
                companyId: company.id,
                dueDate,
            },
        });
        return { id: company.id, businessName: company.businessName };
    }
    async findAll(userId, userRole) {
        const isAdmin = userRole === 'ADMIN';
        const now = new Date();
        const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
        const companies = await this.prisma.company.findMany({
            where: {
                deletedAt: null,
                ...(!isAdmin && { assignments: { some: { userId } } }),
            },
            include: {
                assignments: {
                    include: { user: { select: { id: true, name: true, email: true } } },
                },
                todos: {
                    where: { resolved: false },
                    select: { id: true, dueDate: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });
        return companies.map(company => {
            const assignedUser = company.assignments[0]?.user ?? null;
            const totalTodos = company.todos.length;
            const urgentTodos = company.todos.filter(t => t.dueDate !== null && t.dueDate < fiveDaysFromNow).length;
            const overdueTodos = company.todos.filter(t => t.dueDate !== null && t.dueDate < now).length;
            return {
                id: company.id,
                businessName: company.businessName,
                supportNumber: company.supportNumber,
                country: company.country,
                status: company.status,
                createdAt: company.createdAt,
                assignedUser,
                totalTodos,
                urgentTodos,
                overdueTodos,
            };
        });
    }
    async findOne(id, userId, userRole) {
        const isAdmin = userRole === 'ADMIN';
        const company = await this.prisma.company.findFirst({
            where: {
                id,
                deletedAt: null,
                ...(!isAdmin && { assignments: { some: { userId } } }),
            },
            include: {
                contactInfo: true,
                legalInfo: true,
                accountant: true,
                assignments: {
                    include: { user: { select: { id: true, name: true, email: true } } },
                },
                todos: {
                    include: { task: { select: { id: true, title: true, description: true } } },
                    orderBy: [{ resolved: 'asc' }, { dueDate: 'asc' }],
                },
            },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        const assignedUser = company.assignments[0]?.user ?? null;
        return {
            id: company.id,
            businessName: company.businessName,
            supportNumber: company.supportNumber,
            country: company.country,
            qbPlan: company.qbPlan,
            businessType: company.businessType,
            companyType: company.companyType,
            companyActivity: company.companyActivity,
            status: company.status,
            createdAt: company.createdAt,
            contactInfo: company.contactInfo,
            legalInfo: company.legalInfo,
            accountant: company.accountant,
            assignedUser,
            todos: company.todos,
        };
    }
    async update(id, dto) {
        const company = await this.prisma.company.findFirst({
            where: { id, deletedAt: null },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        try {
            return await this.prisma.company.update({
                where: { id },
                data: { supportNumber: dto.supportNumber },
                select: { id: true, supportNumber: true },
            });
        }
        catch (err) {
            if (err?.code === 'P2002') {
                throw new common_1.ConflictException('This support number is already assigned to another company');
            }
            throw err;
        }
    }
    async assignUser(companyId, userId) {
        const company = await this.prisma.company.findFirst({
            where: { id: companyId, deletedAt: null },
        });
        if (!company)
            throw new common_1.NotFoundException('Company not found');
        await this.prisma.assignment.deleteMany({ where: { companyId } });
        if (userId !== null) {
            const user = await this.prisma.user.findFirst({
                where: { id: userId, deletedAt: null },
            });
            if (!user)
                throw new common_1.NotFoundException('User not found');
            await this.prisma.assignment.create({ data: { companyId, userId } });
        }
        return { ok: true };
    }
};
exports.CompaniesService = CompaniesService;
exports.CompaniesService = CompaniesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_js_1.PrismaService])
], CompaniesService);
//# sourceMappingURL=companies.service.js.map