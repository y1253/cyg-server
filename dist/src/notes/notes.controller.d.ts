import { NotesService } from './notes.service.js';
import { CreateNoteDto } from './dto/create-note.dto.js';
import { UpdateNoteDto } from './dto/update-note.dto.js';
export declare class NotesController {
    private readonly notesService;
    constructor(notesService: NotesService);
    findByCompany(companyId: number, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        note: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        userId: number;
        companyId: number;
        title: string;
    }[]>;
    create(dto: CreateNoteDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        note: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        userId: number;
        companyId: number;
        title: string;
    }>;
    update(id: number, dto: UpdateNoteDto, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        note: string;
        id: number;
        createdAt: Date;
        updatedAt: Date;
        userId: number;
        companyId: number;
        title: string;
    }>;
    remove(id: number, req: {
        user: {
            userId: number;
        };
    }): Promise<{
        id: number;
    }>;
}
