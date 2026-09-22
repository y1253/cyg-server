import type { File as MulterFile } from 'multer';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';
export declare class UsersController {
    private usersService;
    constructor(usersService: UsersService);
    getRoles(): string[];
    directory(req: {
        user: {
            userId: number;
        };
    }): Promise<{
        name: string;
        id: number;
        email: string;
    }[]>;
    findAll(): Promise<(Omit<{
        faceSubject: {
            createdAt: Date;
        } | null;
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        phoneE164: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, "faceSubject"> & {
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    })[]>;
    findOne(id: number): Promise<{
        companies: {
            id: number;
            businessName: string;
            country: string | null;
            status: boolean;
            supportNumber: string | null;
            openTodos: number;
        }[];
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        phoneE164: string | null;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    }>;
    create(dto: CreateUserDto): Promise<Omit<{
        faceSubject: {
            createdAt: Date;
        } | null;
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        phoneE164: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, "faceSubject"> & {
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    }>;
    update(id: number, dto: UpdateUserDto): Promise<Omit<{
        faceSubject: {
            createdAt: Date;
        } | null;
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        phoneE164: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, "faceSubject"> & {
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
    enrollFace(id: number, boxes: string | undefined, files: MulterFile[]): Promise<Omit<{
        faceSubject: {
            createdAt: Date;
        } | null;
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        phoneE164: string | null;
        createdAt: Date;
        updatedAt: Date;
    }, "faceSubject"> & {
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    }>;
}
