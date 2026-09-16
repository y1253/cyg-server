import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sweepStaleOutboundFiles } from './outbound-uploads.js';
import { sweepStaleMmsFiles } from '../phone/mms-staging.util.js';

/**
 * Backstop for the outbound staging dirs.
 *
 * The send paths delete every staged file in a `finally`, so this normally finds
 * nothing. It exists for the two cases that never reach a service method: multer
 * aborting a too-large upload partway through, and a restart mid-send.
 *
 * Two directories, swept together rather than by two crons: email attachments, and the
 * MMS attachments SignalWire fetches. The second matters more than its size suggests —
 * that directory is served by an UNGUARDED route, so a file left behind is a client's
 * photo left reachable to anyone holding its (expiring) URL.
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
    const mms = await sweepStaleMmsFiles();
    if (mms > 0) {
      this.logger.log(`Removed ${mms} stale MMS attachment(s)`);
    }
  }
}
