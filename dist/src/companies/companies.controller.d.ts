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
        assignedUser: {
            name: string;
            email: string;
            id: number;
        };
        totalTodos: number;
        urgentTodos: number;
        overdueTodos: number;
    }[]>;
    findOne(id: number, req: {
        user: {
            userId: number;
            role: string;
        };
    }): Promise<{
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
            fiscalYear: Date | null;
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
        billing: {
            billingEmail: string | null;
            billingPassword: string | null;
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
            startDate: Date | null;
            dueDate: Date | null;
            resolvedAt: Date | null;
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
