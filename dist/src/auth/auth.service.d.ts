import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
export declare class AuthService {
    private usersService;
    private jwtService;
    private config;
    private luxand;
    private prisma;
    constructor(usersService: UsersService, jwtService: JwtService, config: ConfigService, luxand: LuxandService, prisma: PrismaService);
    adminLogin(email: string, password: string): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
    faceLogin(email: string, photo: Buffer, mimeType: string): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
}
