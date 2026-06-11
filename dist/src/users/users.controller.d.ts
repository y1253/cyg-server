import type { File as MulterFile } from 'multer';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';
export declare class UsersController {
    private usersService;
    constructor(usersService: UsersService);
    getRoles(): string[];
    findAll(): Promise<{
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        faceImages: {
            id: number;
        }[];
    }[]>;
    findOne(id: number): Promise<{
        companies: {
            id: number;
            businessName: string;
            country: string | null;
            status: boolean;
            supportNumber: string | null;
            openTodos: number;
        }[];
        faceImages: {
            id: number;
        }[];
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }>;
    create(dto: CreateUserDto): Promise<{
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        faceImages: {
            id: number;
        }[];
    }>;
    update(id: number, dto: UpdateUserDto): Promise<{
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        faceImages: {
            id: number;
        }[];
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
    enrollFace(id: number, files: MulterFile[]): Promise<{
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        faceImages: {
            id: number;
        }[];
    } | null>;
}
