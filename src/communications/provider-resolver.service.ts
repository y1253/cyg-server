import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import type { CommunicationsProvider } from './provider.interface.js';
import type { CommunicationsProviderKind } from './communications.types.js';

/**
 * Resolves a company's connected communications provider. A company has at most one
 * account — a row in GmailAccount OR MicrosoftAccount — so which table holds the row
 * IS the provider. Used by the unified cross-company badge endpoint and available for
 * any future request dispatch that shouldn't care which provider is connected.
 */
@Injectable()
export class ProviderResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly microsoft: MicrosoftService,
  ) {}

  /** The provider connected for a company, or null when none is connected. */
  async getConnectedProvider(
    companyId: number,
  ): Promise<CommunicationsProviderKind | null> {
    const [g, m] = await Promise.all([
      this.prisma.gmailAccount.findUnique({
        where: { companyId },
        select: { id: true },
      }),
      this.prisma.microsoftAccount.findUnique({
        where: { companyId },
        select: { id: true },
      }),
    ]);
    if (g) return 'GOOGLE';
    if (m) return 'MICROSOFT';
    return null;
  }

  /** The provider service for a company, or null when none is connected. */
  async resolve(companyId: number): Promise<CommunicationsProvider | null> {
    const kind = await this.getConnectedProvider(companyId);
    if (kind === 'GOOGLE') return this.gmail;
    if (kind === 'MICROSOFT') return this.microsoft;
    return null;
  }
}
