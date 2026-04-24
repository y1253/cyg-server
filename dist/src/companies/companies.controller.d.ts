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
            id: number;
            name: string;
            email: string;
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
            createdAt: Date;
            updatedAt: Date;
            id: number;
            privateEmail: string | null;
            privatePhone: string | null;
            personalName: string | null;
            storeNumber: string | null;
            companyId: number;
        } | null;
        legalInfo: {
            createdAt: Date;
            updatedAt: Date;
            id: number;
            neq: string | null;
            revenueQcId: string | null;
            craBn: string | null;
            fiscalYear: string | null;
            companyId: number;
        } | null;
        accountant: {
            createdAt: Date;
            updatedAt: Date;
            id: number;
            name: string | null;
            email: string | null;
            phone: string | null;
            companyId: number;
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
            };
        } & {
            createdAt: Date;
            updatedAt: Date;
            id: number;
            resolved: boolean;
            taskId: number;
            companyId: number;
            scheduleId: number | null;
            startDate: Date | null;
            dueDate: Date | null;
            resolvedAt: Date | null;
        })[];
    }>;
    update(id: number, dto: UpdateCompanyDto): Promise<{
        supportNumber: string | null;
        id: number;
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
    assignUser(id: number, dto: AssignCompanyDto): Promise<{
        ok: boolean;
    }>;
}
