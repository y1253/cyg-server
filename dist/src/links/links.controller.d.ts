import { LinksService } from './links.service.js';
import { CreateLinkDto } from './dto/create-link.dto.js';
import { UpdateLinkDto } from './dto/update-link.dto.js';
export declare class LinksController {
    private readonly linksService;
    constructor(linksService: LinksService);
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
