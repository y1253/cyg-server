import * as path from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  sweepStaleFilesIn,
  sweepStaleOutboundFiles,
} from './outbound-uploads.js';
import { sweepStaleMmsFiles } from '../phone/mms-staging.util.js';
import {
  MESSAGES_STAGING_SUBDIR,
  UPLOADS_ROOT,
} from '../internal-messages/uploads.js';

/** Same six hours the outbound sweep uses, and for the same reason: see its docblock. */
const STAGING_STALE_MS = 6 * 60 * 60 * 1000;

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
    // Third directory, added when internal-message attachments moved to object storage:
    // the send deletes its staged copies in a `finally`, but a multer abort partway
    // through a 250 MB upload never reaches the service at all.
    const staged = await sweepStaleFilesIn(
      path.join(UPLOADS_ROOT, MESSAGES_STAGING_SUBDIR),
      STAGING_STALE_MS,
    );
    if (staged > 0) {
      this.logger.log(`Removed ${staged} stale staged attachment(s)`);
    }
  }
}
