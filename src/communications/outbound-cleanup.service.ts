import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sweepStaleOutboundFiles } from './outbound-uploads.js';

/**
 * Backstop for the outbound attachment staging dir.
 *
 * The send paths delete every staged file in a `finally`, so this normally finds
 * nothing. It exists for the two cases that never reach a service method: multer
 * aborting a too-large upload partway through, and a restart mid-send.
 */
@Injectable()
export class OutboundCleanupService {
  private readonly logger = new Logger(OutboundCleanupService.name);

  @Cron(CronExpression.EVERY_HOUR)
  async sweep(): Promise<void> {
    const removed = await sweepStaleOutboundFiles();
    if (removed > 0) {
      this.logger.log(`Removed ${removed} stale outbound attachment(s)`);
    }
  }
}
