import { PrismaService } from '../prisma/prisma.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';
import { ReorderLinksDto } from './dto/reorder-links.dto.js';
export declare class LinksService {
    private prisma;
    constructor(prisma: PrismaService);
    create(dto: CreateLinkDto): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        username: string | null;
        label: string;
        url: string | null;
        sortOrder: number;
    }>;
    update(id: number, dto: UpdateLinkDto): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        username: string | null;
        label: string;
        url: string | null;
        sortOrder: number;
    }>;
    reorder(dto: ReorderLinksDto): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        username: string | null;
        label: string;
        url: string | null;
        sortOrder: number;
    }[]>;
    remove(id: number): Promise<void>;
    findByCompany(companyId: number): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        username: string | null;
        label: string;
        url: string | null;
        sortOrder: number;
    }[]>;
    private decryptLink;
}
