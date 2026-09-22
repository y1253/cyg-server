import { Role } from '@prisma/client';
export declare class UpdateUserDto {
    name?: string;
    email?: string;
    role?: Role;
    phoneE164?: string | null;
}
