import { ForbiddenException, Logger } from '@nestjs/common';
import { Role } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

const logger = new Logger('CompanyPhoneAccess');

/**
 * May this user act on this company's phone — place a call, or pick one up?
 *
 * Deliberately stricter than the JWT-only reads beside it (`timeline`, `sms-thread`),
 * and deliberately looser than the routing rule. Three different questions, three
 * different answers:
 *
 *   routing  — WHO IS RUNG. The assigned user only, so an unassigned admin is never
 *              interrupted by somebody else's call.
 *   this     — WHO MAY ACT. The assigned user, or any admin. An admin who deliberately
 *              opens a company that is ringing has clearly chosen to deal with it.
 *   reads    — WHO MAY LOOK. Any authenticated user, matching the mailbox.
 *
 * Extracted from `PhoneDialerService.assertMayDial` when the ringing endpoint needed the
 * same rule; copying it would have let the two drift, and they answer the same question.
 */
export async function assertMayUseCompanyPhone(
  prisma: PrismaService,
  assignments: { userId: number }[],
  userId: number,
  companyName: string,
  action: string,
): Promise<void> {
  if (assignments.some((a) => a.userId === userId)) return;

  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { role: true },
  });
  if (user?.role === Role.ADMIN) return;

  logger.warn(
    `user ${userId} tried to ${action} for ${companyName} without an assignment`,
  );
  throw new ForbiddenException('Not assigned to this company');
}
