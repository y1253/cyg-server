import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Admin-tier access: everything a MANAGER shares with an ADMIN.
 *
 * MANAGER is "an admin minus the two global admin pages" — the task-template library
 * (`/admin/tasks`) and the firm-wide phone configuration (`/admin/company-settings`).
 * Routes backing those two therefore stay `@Roles(Role.ADMIN)` on their own.
 *
 * `RolesGuard` is deliberately exact-membership with NO hierarchy, so a route left at
 * `@Roles(Role.ADMIN)` stays admin-only by default. That is what makes this list
 * fail closed: a new admin route has to be opted IN to manager access, never out.
 */
export const MANAGEMENT_ROLES = [Role.ADMIN, Role.MANAGER];
