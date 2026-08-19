import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
export declare class UsersService {
    private prisma;
    private luxand;
    private readonly logger;
    constructor(prisma: PrismaService, luxand: LuxandService);
    private static readonly FACE_SELECT;
    private static withFaceFlags;
    findByEmail(email: string): import("@prisma/client").Prisma.Prisma__UserClient<{
        faceSubject: {
            subjectId: string;
        } | null;
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
    } | null, null, import("@prisma/client/runtime/library").DefaultArgs, import("@prisma/client").Prisma.PrismaClientOptions>;
    findAll(): Promise<(Omit<{
        faceSubject: {
            createdAt: Date;
        } | null;
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
    }, "faceSubject"> & {
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    })[]>;
    findDirectory(excludeUserId: number): Promise<{
        id: number;
        name: string;
        email: string;
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
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
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
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
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
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
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
    enrollFace(id: number, photos: {
        buffer: Buffer;
        mimeType: string;
    }[]): Promise<Omit<{
        faceSubject: {
            createdAt: Date;
        } | null;
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
    }, "faceSubject"> & {
        faceEnrolled: boolean;
        faceEnrolledAt: Date | null;
        faceImages: {
            id: number;
        }[];
    }>;
    getRoles(): string[];
}
