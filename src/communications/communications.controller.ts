import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Request,
  UseGuards,
} from '@nestjs/common';
import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InternalMessagesService } from '../internal-messages/internal-messages.service.js';
import { assertOwnCompany } from './company-access.util.js';
import type { LatestPreviewDto } from './communications.types.js';

/**
 * Provider-agnostic Communications endpoints that span all companies regardless of
 * which provider each connected. Per-company reads still go to the provider-specific
 * `/api/gmail/*` and `/api/microsoft/*` controllers; the client picks that base from
 * the `provider` on the account returned here.
 */
@Controller('communications')
@UseGuards(JwtAuthGuard)
export class CommunicationsController {
  constructor(
    private readonly gmail: GmailService,
    private readonly microsoft: MicrosoftService,
    private readonly resolver: ProviderResolverService,
    private readonly internal: InternalMessagesService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The company's connected communications account (whichever provider). The client
   * fetches this first, then routes every other request to `/api/gmail/*` or
   * `/api/microsoft/*` based on `account.provider`.
   *
   * 404s when nothing is connected, matching the per-provider routes
   * (`GmailService.getAccount`, `MicrosoftService.getAccount`). It must not return
   * `null`: Nest sends a nil return as a 200 with a zero-length body, which is not
   * valid JSON, so every client parsing the response threw on it.
   */
  @Get('companies/:companyId/account')
  async account(@Param('companyId', ParseIntPipe) companyId: number) {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) {
      throw new NotFoundException('No communications account connected');
    }
    return provider.getAccount(companyId);
  }

  /**
   * Uncompleted-message counts for every company with a connected account, keyed by
   * company id. Each company uses exactly one provider, so the two maps never
   * overlap and a plain merge is correct. Powers the dashboard / company-list badges.
   *
   * The caller's own internal "Cyg Finance" workspace is folded in under its own
   * company id, so the dashboard badge renders through the identical code path as
   * a real company. Only ever the caller's own workspace — never another user's.
   */
  /**
   * Newest inbox item for a company, as a popup body. Fetched lazily by the client
   * the moment a new-message alert fires — the count map that detects the arrival
   * carries integers only, so the content has to come from somewhere.
   *
   * Authorized by assignment, NOT by the "admin sees all" rule used elsewhere: this
   * route exists only to fill a notification that an unassigned admin never gets.
   * Returns null (200) rather than throwing when the lookup fails, so a broken
   * mailbox downgrades the popup instead of losing it.
   */
  @Get('companies/:companyId/latest-preview')
  async latestPreview(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Request() req: { user: { userId: number } },
  ): Promise<LatestPreviewDto | null> {
    await assertOwnCompany(this.prisma, companyId, req.user.userId);
    const provider = await this.resolver.resolve(companyId);
    if (!provider) return null;
    return provider.getLatestPreview(companyId);
  }

  @Get('uncompleted-counts')
  async uncompletedCounts(
    @Request() req: { user: { userId: number } },
  ): Promise<Record<number, number>> {
    const [g, m, workspace, internalCount] = await Promise.all([
      this.gmail.getUncompletedCounts(),
      this.microsoft.getUncompletedCounts(),
      this.prisma.company.findUnique({
        where: { internalOwnerId: req.user.userId },
        select: { id: true },
      }),
      this.internal.getUncompletedCount(req.user.userId),
    ]);
    return {
      ...g,
      ...m,
      ...(workspace && { [workspace.id]: internalCount }),
    };
  }
}
