import { CompaniesService } from './companies.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
export declare class CompaniesController {
    private readonly companiesService;
    constructor(companiesService: CompaniesService);
    register(dto: RegisterCompanyDto): Promise<{
        id: number;
        businessName: string;
    }>;
}
