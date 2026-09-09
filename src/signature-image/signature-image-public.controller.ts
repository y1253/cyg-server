import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { streamAttachmentFile } from '../communications/attachment-stream.util.js';
import { SignatureImageService } from './signature-image.service.js';

/**
 * The signature logo's bytes — the one genuinely PUBLIC route in this application.
 *
 * ── WHY THIS IS UNAUTHENTICATED, AND WHY THAT IS NOT A REGRESSION ───────────────
 * Every other byte route here carries a JWT in the query string: `phone/audio/:id`,
 * `internal-messages/attachments/:id`, `phone/recordings/:sid`. All three are fetched by a
 * logged-in browser. This one is fetched by a STRANGER'S MAIL CLIENT — or by Gmail's image
 * proxy on their behalf — which has no session, no cookie, and no idea this app exists. A
 * token-bearing URL 401s for exactly the reader it is meant for.
 *
 * `recording-token.util.ts` argues that "hard to guess" is not access control, and it is
 * right — about a recorded client call, which is confidential. A company's own logo is
 * about to be mailed to strangers by design, so there is nothing here to protect. The
 * random `publicId` exists to stop the URL space being enumerated, not to authorise.
 *
 * ⚠️ Keep this class holding NOTHING ELSE. Every route in it is public, which is what makes
 * that reviewable at a glance; adding a guarded route here is how the next unguarded one
 * gets added by accident.
 */
@Controller('signature-images/public')
export class SignatureImagePublicController {
  constructor(private readonly images: SignatureImageService) {}

  @Get(':publicId')
  async serve(
    @Param('publicId') publicId: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    const file = await this.images.streamableByPublicId(publicId);
    await streamAttachmentFile(
      res,
      file.absolutePath,
      file.mimeType,
      file.filename,
      'inline',
      range,
      // `public`, unlike every other caller: this is meant to be cached by Gmail's image
      // proxy and by the recipient's client. A day, because the bytes at a given publicId
      // never change — a re-upload mints a new id.
      'public, max-age=86400',
    );
  }
}
