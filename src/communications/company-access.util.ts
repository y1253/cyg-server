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
