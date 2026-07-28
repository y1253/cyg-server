import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * The per-user internal workspace ("Cyg Finance").
 *
 * It is a `Company` row flagged `isInternal` and owned via `internalOwnerId`, NOT
 * a real client company. It exists so the internal messaging inbox and the user's
 * private Links have a container the existing `/companies/:id` detail page can
 * render — reusing `Link.companyId`'s FK unchanged.
 *
 * Every user owns exactly one, enforced by `@unique` on `Company.internalOwnerId`.
 * It is deliberately excluded from registration, todos/schedules, assignment,
 * the archived view, and permanent delete (see CompaniesService).
 */
export const INTERNAL_WORKSPACE_NAME = 'Cyg Finance';

/** Prisma client or an interactive-transaction client — both work here. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Create the user's internal workspace if they don't have one yet, and return it.
 *
 * Idempotent: `internalOwnerId` is `@unique`, so the upsert is race-safe and
 * re-running this (seed backfill, login safety net) never duplicates a row. Also
 * un-deletes a workspace that was soft-deleted along with a previously removed user.
 *
 * Implemented as a plain function rather than a service method so `UsersService`,
 * `AuthService` and the seed can all call it — including inside a `$transaction` —
 * without importing `CompaniesModule` and creating a dependency cycle.
 */
export async function ensureInternalWorkspace(db: Db, userId: number) {
  return db.company.upsert({
    where: { internalOwnerId: userId },
    update: { deletedAt: null },
    create: {
      businessName: INTERNAL_WORKSPACE_NAME,
      isInternal: true,
      internalOwnerId: userId,
    },
  });
}
