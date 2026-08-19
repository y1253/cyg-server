import { CompaniesService } from './companies.service.js';
import { AssignCompanyDto } from './dto/assign-company.dto.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
import { UpdateCompanyDto } from './dto/update-company.dto.js';
export declare class CompaniesController {
    private readonly companiesService;
    constructor(companiesService: CompaniesService);
    register(dto: RegisterCompanyDto): Promise<{
        id: number;
        businessName: string;
    }>;
    findAll(req: {
        user: {
            userId: number;
            role: string;
        };
    }): Promise<{
        id: number;
        businessName: string;
        supportNumber: string | null;
        country: string | null;
        status: boolean;
        createdAt: Date;
        isInternal: boolean;
        assignedUser: {
            id: number;
            name: string;
            email: string;
        };
        totalTodos: number;
        urgentTodos: number;
        overdueTodos: number;
        importantTodos: number;
    }[]>;
    findAllDeleted(): Promise<{
        id: number;
        businessName: string;
        businessType: import("@prisma/client").$Enums.BusinessType | null;
        country: string | null;
        deletedAt: Date | null;
    }[]>;
    restore(id: number): Promise<{
        id: number;
    }>;
    permanentDelete(id: number): Promise<{
        id: number;
    }>;
    findOne(id: number, req: {
        user: {
            userId: number;
            role: string;
        };
    }): Promise<{
        id: number;
        businessName: string;
        isInternal: boolean;
        supportNumber: string | null;
        country: string | null;
        qbPlan: string | null;
        businessType: import("@prisma/client").$Enums.BusinessType | null;
        companyType: import("@prisma/client").$Enums.CompanyType | null;
        companyActivity: string | null;
        status: boolean;
        createdAt: Date;
        deletedAt: Date | null;
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
            id: number;
            name: string | null;
            email: string | null;
            createdAt: Date;
            updatedAt: Date;
            companyId: number;
            phone: string | null;
        } | null;
        billing: {
            billingEmail: string | null;
            billingPassword: string | null;
        } | null;
        assignedUser: {
            id: number;
            name: string;
            email: string;
        };
        todos: ({
            task: {
                id: number;
                title: string;
                description: string | null;
                isSnoozable: boolean;
                orderNumber: number | null;
            };
        } & {
            id: number;
            createdAt: Date;
            updatedAt: Date;
            resolved: boolean;
            companyId: number;
            dueDate: Date | null;
            resolvedAt: Date | null;
            snoozedUntil: Date | null;
            taskId: number;
            scheduleId: number | null;
        })[];
    }>;
    update(id: number, dto: UpdateCompanyDto): Promise<{
        id: number;
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
    assignUser(id: number, dto: AssignCompanyDto): Promise<{
        ok: boolean;
    }>;
}
