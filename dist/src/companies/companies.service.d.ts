import { PrismaService } from '../prisma/prisma.service.js';
import { RegisterCompanyDto } from './dto/register-company.dto.js';
export declare class CompaniesService {
    private prisma;
    constructor(prisma: PrismaService);
    register(dto: RegisterCompanyDto): Promise<{
        id: number;
        businessName: string;
    }>;
}
