import type { File as MulterFile } from 'multer';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
export declare class AuthController {
    private authService;
    constructor(authService: AuthService);
    adminLogin(dto: LoginDto): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: string;
        };
    }>;
    faceLogin(email: string, file: MulterFile): Promise<{
        access_token: string;
        user: {
            id: number;
            name: string;
            email: string;
            role: import("@prisma/client").$Enums.Role;
        };
    }>;
}
