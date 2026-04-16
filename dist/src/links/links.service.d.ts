import { PrismaService } from '../prisma/prisma.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';
export declare class LinksService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateLinkDto): Promise<{
        id: number;
        companyId: number;
        label: string;
        url: string;
    }>;
    update(id: number, dto: UpdateLinkDto): Promise<{
        id: number;
        companyId: number;
        label: string;
        url: string;
    }>;
    remove(id: number): Promise<void>;
    findByCompany(companyId: number): Promise<{
        id: number;
        companyId: number;
        label: string;
        url: string;
    }[]>;
}
