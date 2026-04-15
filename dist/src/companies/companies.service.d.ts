import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
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
            personalName: string | null;
            privateEmail: string | null;
            privatePhone: string | null;
            storeNumber: string | null;
            companyId: number;
        } | null;
        legalInfo: {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            neq: string | null;
            revenueQcId: string | null;
            craBn: string | null;
            fiscalYear: string | null;
            companyId: number;
        } | null;
        accountant: {
            name: string | null;
            email: string | null;
            id: number;
            createdAt: Date;
            updatedAt: Date;
            phone: string | null;
            companyId: number;
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
            dueDate: Date | null;
            resolved: boolean;
            resolvedAt: Date | null;
            taskId: number;
            companyId: number;
            scheduleId: number | null;
        })[];
    }>;
    assignUser(companyId: number, userId: number | null): Promise<{
        ok: boolean;
    }>;
}
