import { Role } from '@prisma/client';

/**
 * The imperative twin of `MANAGEMENT_ROLES` — for the places that branch on the
 * caller's role inside a service rather than gating a whole route (company
 * visibility scoping, billing decryption, the "are you assigned?" todo guard).
 *
 * Takes a loose string because the JWT payload types `role` as `string`
 * (`jwt.strategy.ts`), not as the Prisma enum.
 */
export function isManagement(role: string | undefined | null): boolean {
  return role === Role.ADMIN || role === Role.MANAGER;
}
