import { ContactsService } from './contacts.service.js';
import { CreateContactDto } from './dto/create-contact.dto.js';
import { UpdateContactDto } from './dto/update-contact.dto.js';
export declare class ContactsController {
    private readonly contacts;
    constructor(contacts: ContactsService);
    findByCompany(companyId: number): Promise<{
        id: number;
        name: string;
        email: string | null;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        phone: string;
        phoneE164: string | null;
        autoSource: string | null;
    }[]>;
    create(dto: CreateContactDto): Promise<{
        id: number;
        name: string;
        email: string | null;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        phone: string;
        phoneE164: string | null;
        autoSource: string | null;
    }>;
    update(id: number, dto: UpdateContactDto): Promise<{
        id: number;
        name: string;
        email: string | null;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        companyId: number;
        note: string | null;
        phone: string;
        phoneE164: string | null;
        autoSource: string | null;
    }>;
    remove(id: number): Promise<void>;
}
