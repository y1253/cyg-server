import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';

/** The minimum a per-company settings feature needs to know about its target. */
export interface CompanyTarget {
  id: number;
  businessName: string;
  isInternal: boolean;
}

/**
 * The company a per-company settings feature may act on: live, not soft-deleted, and not
 * an internal "Cyg Finance" workspace.
 *
 * A free function taking `prisma`, following `phone/company-phone-access.util.ts` — the
 * callers live in different modules (`email-signature`, `signature-image`) and injecting a
 * service across them to ask one question is the heavier coupling.
 *
 * `internalMessage` is a PARAMETER rather than a constant because the sentence has to say
 * what THIS feature does not do. "Internal workspaces are excluded" tells the reader
 * nothing; "internal workspaces send no email and have no signature" tells them why.
 *
 * `PhoneSettingsService.assertCompany` is deliberately NOT a caller: its select also
 * carries `supportNumber`, and making that generic would cost either a second query or a
 * type parameter, for one saved `if`.
 */
export async function assertRealCompany(
  prisma: PrismaService,
  companyId: number,
  internalMessage: string,
): Promise<CompanyTarget> {
  const company = await prisma.company.findFirst({
    where: { id: companyId, deletedAt: null },
    select: { id: true, businessName: true, isInternal: true },
  });
  if (!company) throw new NotFoundException('Company not found');
  if (company.isInternal) throw new BadRequestException(internalMessage);
  return company;
}
