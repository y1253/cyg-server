import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

/**
 * Is this company the caller's to be notified about?
 *
 * Deliberately NOT the same rule as `CompaniesService.findAll`, which lets an admin
 * SEE every company. This answers a narrower question — "is this user the one working
 * this mailbox?" — and it is the rule behind new-message popups: an admin who is not
 * assigned still gets the company in their list and still gets its unread badge, but
 * is not interrupted by mail somebody else is responsible for.
 *
 * The caller's own internal "Cyg Finance" workspace counts, since it holds their own
 * messages and carries no Assignment row.
 */
export async function isOwnCompany(
  prisma: PrismaService,
  companyId: number,
  userId: number,
): Promise<boolean> {
  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      deletedAt: null,
      OR: [{ internalOwnerId: userId }, { assignments: { some: { userId } } }],
    },
    select: { id: true },
  });
  return company !== null;
}

/** `isOwnCompany` as a guard. 403 rather than 404: the id itself is not a secret. */
export async function assertOwnCompany(
  prisma: PrismaService,
  companyId: number,
  userId: number,
): Promise<void> {
  if (!(await isOwnCompany(prisma, companyId, userId))) {
    throw new ForbiddenException('Not assigned to this company');
  }
}

/**
 * Every company the caller is the one working — the multi-company form of
 * `isOwnCompany`, for the notification bell's cross-company unread feed.
 *
 * Lives here, beside the single-company rule, so the bell's scope cannot drift from
 * the new-message popup's. They answer the same question and must keep answering it
 * the same way: an admin who is not assigned still SEES the company and its badge,
 * and is still not interrupted by mail somebody else is responsible for.
 *
 * Returns the name too, because the feed carries it per row — the client's company
 * cache has no refetch interval and can be cold for a freshly assigned company.
 */
export async function listOwnCompanies(
  prisma: PrismaService,
  userId: number,
): Promise<{ id: number; businessName: string; isInternal: boolean }[]> {
  return prisma.company.findMany({
    where: {
      deletedAt: null,
      OR: [{ internalOwnerId: userId }, { assignments: { some: { userId } } }],
    },
    select: { id: true, businessName: true, isInternal: true },
  });
}
