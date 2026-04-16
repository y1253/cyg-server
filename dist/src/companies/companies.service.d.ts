import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
export declare class CompaniesService {
    private prisma;
    constructor(prisma: PrismaService);
    register(dto: RegisterCompanyDto): Promise<{
        id: number;
        businessName: string;
    }>;
    findAll(userId: number, userRole: string): Promise<{
        id: number;
        businessName: string;
        supportNumber: string | null;
        country: string | null;
        status: boolean;
        createdAt: Date;
        assignedUser: {
            name: string;
            email: string;
            id: number;
        };
        totalTodos: number;
        urgentTodos: number;
        overdueTodos: number;
    }[]>;
    findOne(id: number, userId: number, userRole: string): Promise<{
        id: number;
        businessName: string;
        supportNumber: string | null;
        country: string | null;
        qbPlan: string | null;
        businessType: import("@prisma/client").$Enums.BusinessType | null;
        companyType: import("@prisma/client").$Enums.CompanyType | null;
        companyActivity: string | null;
        status: boolean;
        createdAt: Date;
        contactInfo: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            companyId: number;
            personalName: string | null;
            privateEmail: string | null;
            privatePhone: string | null;
            storeNumber: string | null;
        } | null;
        legalInfo: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            companyId: number;
            neq: string | null;
            revenueQcId: string | null;
            craBn: string | null;
            fiscalYear: string | null;
        } | null;
        accountant: {
            name: string | null;
            email: string | null;
            id: number;
            createdAt: Date;
            updatedAt: Date;
            companyId: number;
            phone: string | null;
        } | null;
        assignedUser: {
            name: string;
            email: string;
            id: number;
        };
        todos: ({
            task: {
                id: number;
                title: string;
                description: string | null;
            };
        } & {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            resolved: boolean;
            companyId: number;
            dueDate: Date | null;
            resolvedAt: Date | null;
            taskId: number;
            scheduleId: number | null;
        })[];
    }>;
    update(id: number, dto: UpdateCompanyDto): Promise<{
        id: number;
        supportNumber: string | null;
    }>;
    assignUser(companyId: number, userId: number | null): Promise<{
        ok: boolean;
    }>;
}
