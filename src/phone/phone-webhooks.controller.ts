import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { emptyResponse, sayAndHangup } from './laml.util.js';
import { SIGNATURE_HEADER, verifySignature } from './signature.util.js';
import { webhookUrls } from './phone.config.js';

/**
 * SignalWire's callbacks. UNAUTHENTICATED by necessity — SignalWire is the caller and
 * cannot present a JWT — so every route verifies the request signature instead.
 *
 * Deliberately a SEPARATE controller from `phone.controller.ts`, which is entirely
 * JWT-guarded. Mixing guarded and unguarded routes in one class is how an unguarded
 * one eventually gets added by accident. Precedent: `gmail.controller.ts:389`.
 *
 * ── Why this file exists ────────────────────────────────────────────────────────
 * Numbers have been sold with `VoiceUrl`/`SmsUrl`/`StatusCallback` pointing here since
 * the provisioning increment shipped, but nothing served the paths. Every inbound call
 * 404'd (64 of them), SignalWire had no instructions, and the caller heard
 * "this call cannot be completed". A 404 and an empty body are NOT valid answers to a
 * LaML webhook; a well-formed `<Response>` is, even an empty one.
 */
@Controller('phone')
export class PhoneWebhooksController {
  private readonly logger = new Logger(PhoneWebhooksController.name);

  /**
   * Rejects anything not signed by SignalWire.
   *
   * The URL is rebuilt from `webhookUrls()` — the SAME source that told SignalWire
   * where to POST — rather than from the incoming request. Behind nginx `req.protocol`
   * reports `http` and the host header can carry a port; either changes the signed
   * string and would fail every genuine request. Deriving both sides from one function
   * means they cannot drift.
   */
  private assertSigned(
    signature: string | undefined,
    url: string,
    body: Record<string, unknown>,
  ): void {
    if (
      !verifySignature(
        signature,
        url,
        body,
        process.env.SIGNALWIRE_API_TOKEN,
      )
    ) {
      this.logger.warn(
        `Rejected unsigned webhook for ${url} ` +
          `(From=${String(body?.From ?? '?')} To=${String(body?.To ?? '?')})`,
      );
      throw new ForbiddenException('Invalid signature');
    }
  }

  /**
   * An inbound PSTN call. Must answer with LaML.
   *
   * PHASE 1 — this returns a holding message, which is enough to stop the failure
   * tone. The ring-the-assigned-user routing replaces the body of this method in
   * phase 2; the signature check, the logging and the content type all stay.
   */
  @Post('voice/inbound')
  @Header('Content-Type', 'text/xml')
  voiceInbound(
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ): string {
    this.assertSigned(signature, webhookUrls(process.env).voiceUrl, body);

    this.logger.log(
      `inbound call From=${String(body.From ?? '?')} ` +
        `To=${String(body.To ?? '?')} CallSid=${String(body.CallSid ?? '?')}`,
    );

    return sayAndHangup(
      'Thank you for calling. Nobody is available to take your call right now. ' +
        'Please leave us an email and we will get back to you shortly.',
    );
  }

  /**
   * Call progress. Nothing acts on it yet; it is answered so it stops 404-ing (192 of
   * those so far) and so the CallSid/status pairs are in the log when missed-call
   * handling is built.
   */
  @Post('voice/status')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  voiceStatus(
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ): string {
    this.assertSigned(signature, webhookUrls(process.env).statusCallback, body);

    this.logger.log(
      `call status CallSid=${String(body.CallSid ?? '?')} ` +
        `status=${String(body.CallStatus ?? '?')} ` +
        `duration=${String(body.CallDuration ?? '0')}s`,
    );
    return emptyResponse();
  }

  /**
   * Inbound SMS. Answered with an empty `<Response/>` so SignalWire does not auto-reply
   * and does not retry. Two-way texting is a later increment.
   */
  @Post('sms/inbound')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  smsInbound(
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ): string {
    this.assertSigned(signature, webhookUrls(process.env).smsUrl, body);

    this.logger.log(
      `inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')}`,
    );
    return emptyResponse();
  }
}
