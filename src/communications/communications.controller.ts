import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

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
  ) {}

  /**
   * The company's connected communications account (whichever provider), or null
   * when none is connected. The client fetches this first, then routes every other
   * request to `/api/gmail/*` or `/api/microsoft/*` based on `account.provider`.
   */
  @Get('companies/:companyId/account')
  async account(@Param('companyId', ParseIntPipe) companyId: number) {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) return null;
    return provider.getAccount(companyId);
  }

  /**
   * Uncompleted-message counts for every company with a connected account, keyed by
   * company id. Each company uses exactly one provider, so the two maps never
   * overlap and a plain merge is correct. Powers the dashboard / company-list badges.
   */
  @Get('uncompleted-counts')
  async uncompletedCounts(): Promise<Record<number, number>> {
    const [g, m] = await Promise.all([
      this.gmail.getUncompletedCounts(),
      this.microsoft.getUncompletedCounts(),
    ]);
    return { ...g, ...m };
  }
}
