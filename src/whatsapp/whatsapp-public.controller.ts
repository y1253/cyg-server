import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { verifyQueryTokenUser } from '../communications/attachment-stream.util.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { streamStoredObject } from '../storage/stored-object.js';
import { WhatsAppMessagesService } from './whatsapp-messages.service.js';
import {
  parseWebhook,
  verifyMetaSignature,
  whatsappConfig,
} from './whatsapp.util.js';

/**
 * The only unguarded WhatsApp routes, in a class holding nothing else.
 *
 * - The webhook is called by Meta, which cannot present a JWT. Its signature check IS the
 *   security boundary, and it fails closed.
 * - The media route is an `<img>`/`<audio>` src, which cannot send a header, so it takes
 *   the session token in the query string (the internal-attachments pattern) — the same
 *   "any logged-in user may read" tier as the WhatsApp timeline itself.
 */
@Controller('whatsapp')
export class WhatsAppPublicController {
  private readonly logger = new Logger(WhatsAppPublicController.name);

  constructor(
    private readonly messages: WhatsAppMessagesService,
    private readonly storage: ObjectStorageService,
  ) {}

  /** Meta's one-time subscription handshake: echo `hub.challenge` if the token matches. */
  @Get('webhook')
  verify(
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const expected = whatsappConfig(process.env).verifyToken;
    if (!expected) {
      this.logger.error(
        'webhook verification refused: WHATSAPP_VERIFY_TOKEN is not set',
      );
      res.status(HttpStatus.FORBIDDEN).send('Forbidden');
      return;
    }
    if (
      query['hub.mode'] === 'subscribe' &&
      query['hub.verify_token'] === expected
    ) {
      res
        .status(HttpStatus.OK)
        .type('text/plain')
        .send(query['hub.challenge'] ?? '');
      return;
    }
    this.logger.warn('webhook verification refused: token mismatch');
    res.status(HttpStatus.FORBIDDEN).send('Forbidden');
  }

  /**
   * Inbound messages and delivery statuses.
   *
   * Answers 200 as soon as the signature checks out and does the work afterwards: Meta
   * retries a slow webhook, and the unique wamid is what makes those retries harmless.
   * Needs `rawBody: true` in main.ts — the HMAC is over the exact bytes Meta sent.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  receive(
    @Req() req: RawBodyRequest<ExpressRequest>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ) {
    const secret = whatsappConfig(process.env).appSecret;
    if (!secret) {
      this.logger.error('webhook rejected: WHATSAPP_SECRET is not set');
      throw new ForbiddenException();
    }
    if (!verifyMetaSignature(req.rawBody, signature, secret)) {
      this.logger.warn(
        `webhook rejected: signature ${signature ? 'mismatched' : 'absent'}, raw body ${req.rawBody ? 'present' : 'ABSENT'}`,
      );
      throw new ForbiddenException();
    }

    const changes = parseWebhook(req.body);
    // The catch is load-bearing: an unhandled rejection exits the process.
    void this.messages
      .ingest(changes)
      .catch((err) =>
        this.logger.error(`webhook ingest failed: ${String(err)}`),
      );
    return 'EVENT_RECEIVED';
  }

  /** `variant=playback` serves the mp3 made from an audio message. Range/206 for scrubbing. */
  @Get('media/:messageId')
  async media(
    @Param('messageId', ParseIntPipe) messageId: number,
    @Query('token') token: string,
    @Query('variant') variant: string | undefined,
    @Query('download') download: string | undefined,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ) {
    verifyQueryTokenUser(token);
    const file = await this.messages.mediaFile(
      messageId,
      variant === 'playback' ? 'playback' : 'original',
    );
    await streamStoredObject(res, this.storage, file.storageKey, {
      mimeType: file.mimeType,
      filename: file.filename,
      disposition: download === '1' ? 'attachment' : 'inline',
      range,
    });
  }
}
