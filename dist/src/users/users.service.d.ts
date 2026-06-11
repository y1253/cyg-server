import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
export declare class UsersService {
    private prisma;
    private luxand;
    constructor(prisma: PrismaService, luxand: LuxandService);
    findByEmail(email: string): import("@prisma/client").Prisma.Prisma__UserClient<({
        faceImages: {
            id: number;
            createdAt: Date;
            userId: number;
            luxandId: string;
        }[];
    } & {
        name: string;
        id: number;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }) | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
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
    enrollFace(id: number, photos: {
        buffer: Buffer;
        mimeType: string;
    }[]): Promise<{
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
    getRoles(): string[];
}
