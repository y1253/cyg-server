import { PrismaService } from '../prisma/prisma.service.js';
import { CreateNoteDto } from './dto/create-note.dto.js';
import { UpdateNoteDto } from './dto/update-note.dto.js';
export declare class NotesService {
    private prisma;
    constructor(prisma: PrismaService);
    findByCompany(companyId: number, userId: number): Promise<{
        note: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        userId: number;
        companyId: number;
        title: string;
    }[]>;
    create(dto: CreateNoteDto, userId: number): Promise<{
        note: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        userId: number;
        companyId: number;
        title: string;
    }>;
    update(id: number, dto: UpdateNoteDto, userId: number): Promise<{
        note: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        userId: number;
        companyId: number;
        title: string;
    }>;
    remove(id: number, userId: number): Promise<{
        id: number;
    }>;
}
