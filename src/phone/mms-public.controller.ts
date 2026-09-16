import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { streamAttachmentFile } from '../communications/attachment-stream.util.js';
import { assertMmsToken, resolveStagedMms } from './mms-staging.util.js';

/**
 * Staged outbound MMS attachments, fetched by SIGNALWIRE.
 *
 * ── WHY THIS ROUTE HAS NO JwtAuthGuard ────────────────────────────────────────
 * The Compatibility API takes an attachment as a `MediaUrl` it fetches over the public
 * internet; there is no endpoint to post bytes to. So the fetcher is a provider's HTTP
 * client with no session — the same predicament as the signature logo, and the opposite of
 * every other byte route here, which is only ever read by a logged-in browser.
 *
 * What is NOT copied from the logo route is the rest of its posture, because this is a
 * client's document rather than a firm asset meant for strangers:
 *
 *  - the token is bound to the one staged file and expires in MINUTES (SignalWire fetches
 *    within seconds of the POST) rather than the recording token's hour;
 *  - the file is swept within the hour — NOT on the way out of the send handler, because
 *    SignalWire fetches this URL after the POST returns and deleting then races the
 *    download, producing a message that reports `sent` and arrives with no picture;
 *  - and `no-store`, where the logo deliberately sends `public, max-age=86400` so Gmail's
 *    image proxy can cache it. Nothing should keep a copy of this.
 *
 * ⚠️ Keep this class holding NOTHING ELSE — the rule `SignatureImagePublicController` and
 * `PhoneWebhooksController` both follow. Every route in it is public, which is what makes
 * that reviewable at a glance; adding a guarded route here is how the next unguarded one
 * gets added by accident.
 */
@Controller('phone/mms')
export class MmsPublicController {
  @Get(':filename')
  async serve(
    @Param('filename') filename: string,
    @Query('token') token: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    // The name arrives in a URL on an unguarded route, so it is hostile input: one path
    // segment of exactly the shape we mint, or nothing.
    const absolute = resolveStagedMms(filename);
    if (!absolute) throw new NotFoundException();
    assertMmsToken(token, filename);

    await streamAttachmentFile(
      res,
      absolute,
      undefined,
      filename,
      'inline',
      range,
      'private, no-store',
    );
  }
}
