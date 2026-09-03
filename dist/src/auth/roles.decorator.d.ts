import { Role } from '@prisma/client';
export declare const ROLES_KEY = "roles";
export declare const Roles: (...roles: Role[]) => import("@nestjs/common").CustomDecorator<string>;
export declare const MANAGEMENT_ROLES: ("ADMIN" | "MANAGER")[];
