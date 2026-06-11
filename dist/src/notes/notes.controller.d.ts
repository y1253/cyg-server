import { NotesService } from './notes.service.js';
import { CreateNoteDto } from './dto/create-note.dto.js';
import { UpdateNoteDto } from './dto/update-note.dto.js';
export declare class NotesController {
    private readonly notesService;
    constructor(notesService: NotesService);
    create(dto: CreateNoteDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        content: string;
    }>;
    findByCompany(companyId: number): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        content: string;
    }[]>;
    update(id: number, dto: UpdateNoteDto): Promise<{
        id: number;
        createdAt: Date;
        updatedAt: Date;
        companyId: number;
        content: string;
    }>;
    remove(id: number): Promise<void>;
}
