import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UsersService } from './users.service.js';
export declare class UsersController {
    private usersService;
    constructor(usersService: UsersService);
    getRoles(): string[];
    findAll(): Promise<{
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }[]>;
    create(dto: CreateUserDto): Promise<{
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }>;
    update(id: number, dto: UpdateUserDto): Promise<{
        id: number;
        name: string;
        email: string;
        role: import("@prisma/client").$Enums.Role;
        createdAt: Date;
        updatedAt: Date;
        deletedAt: Date | null;
    }>;
    remove(id: number): Promise<{
        id: number;
    }>;
}
