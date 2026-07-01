import { LinksService } from './links.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';
export declare class LinksController {
    private readonly linksService;
    constructor(linksService: LinksService);
    create(dto: CreateLinkDto): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        label: string;
        url: string;
        username: string | null;
    }>;
    update(id: number, dto: UpdateLinkDto): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        label: string;
        url: string;
        username: string | null;
    }>;
    remove(id: number): Promise<void>;
    findByCompany(companyId: number): Promise<{
        id: number;
        companyId: number;
        password: string | null;
        note: string | null;
        label: string;
        url: string;
        username: string | null;
    }[]>;
}
