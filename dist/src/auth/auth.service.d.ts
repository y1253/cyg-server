import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FaceEnhancerService } from '../luxand/face-enhancer.service.js';
import { LuxandService } from '../luxand/luxand.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UsersService } from '../users/users.service.js';
export declare class AuthService {
    private usersService;
    private jwtService;
    private config;
    private luxand;
    private enhancer;
    private prisma;
    private readonly logger;
    constructor(usersService: UsersService, jwtService: JwtService, config: ConfigService, luxand: LuxandService, enhancer: FaceEnhancerService, prisma: PrismaService);
    adminLogin(email: string, password: string): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
    faceLogin(email: string, photo: Buffer, mimeType: string, faceBox?: string): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
}
