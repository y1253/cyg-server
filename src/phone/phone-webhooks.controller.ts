import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { dialSip, emptyResponse, sayAndHangup } from './laml.util.js';
import {
  LEGACY_SIGNATURE_HEADER,
  SIGNATURE_HEADER,
  verifySignature,
} from './signature.util.js';
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
    req: Request,
    url: string,
    body: Record<string, unknown>,
  ): void {
    // Prefer SignalWire's own header; accept the Twilio-compatible one as a fallback.
    // Both are checked against the same key, so accepting the second grants nothing.
    const signature =
      (req.headers[SIGNATURE_HEADER] as string | undefined) ??
      (req.headers[LEGACY_SIGNATURE_HEADER] as string | undefined);

    const signingKey = process.env.SIGNALWIRE_SIGN_KEY;
    if (!signingKey) {
      // Named misconfiguration rather than a mysterious 403. Still rejects: these are
      // the only publicly reachable routes here, and in the next increment they decide
      // whose phone rings.
      this.logger.error(
        'SIGNALWIRE_SIGN_KEY is not set — every webhook will be rejected. ' +
          'Copy the Signing Key from the SignalWire dashboard (API Credentials) ' +
          'into server/.env. It is NOT the API token.',
      );
    }

    if (!verifySignature(signature, url, body, signingKey)) {
      // Name the signature-ish headers that ACTUALLY arrived. Two wrong guesses about
      // this header have each cost a deploy cycle; a third must be readable in one log
      // line instead of inferred. Names only — a signature value is a secret-derived
      // token and does not belong in a log.
      const seen = Object.keys(req.headers).filter((h) =>
        /sign|twilio|signalwire/i.test(h),
      );
      this.logger.warn(
        `Rejected webhook for ${url} ` +
          `(From=${String(body?.From ?? '?')} To=${String(body?.To ?? '?')}) — ` +
          `signature header ${signature ? 'present but did NOT match' : 'ABSENT'}; ` +
          `candidate headers received: ${seen.length ? seen.join(', ') : 'none'}`,
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
  // Nest answers POST with 201 by default. LaML webhooks are expected to be 200, so
  // this is set explicitly on every route here rather than left to the framework.
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  voiceInbound(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): string {
    this.assertSigned(req, webhookUrls(process.env).voiceUrl, body);

    this.logger.log(
      `inbound call From=${String(body.From ?? '?')} ` +
        `To=${String(body.To ?? '?')} CallSid=${String(body.CallSid ?? '?')}`,
    );

    // ── PHASE 2a SPIKE — TEMPORARY, REVERT ────────────────────────────────────
    // Hardcoded to one SIP endpoint to prove a browser can be rung at all. The real
    // routing (To -> SupportNumber -> Company -> assigned user, admins as fallback)
    // replaces this once the SIP leg is known to work. `SPIKE_SIP_TARGET` unset =
    // fall through to the holding message, so production is unaffected if it is not
    // configured.
    const spikeTarget = process.env.SPIKE_SIP_TARGET;
    if (spikeTarget) {
      this.logger.warn(`SPIKE: dialling ${spikeTarget}`);
      return dialSip([{ uri: spikeTarget }], { timeout: 30 });
    }

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
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): string {
    this.assertSigned(req, webhookUrls(process.env).statusCallback, body);

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
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): string {
    this.assertSigned(req, webhookUrls(process.env).smsUrl, body);

    this.logger.log(
      `inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')}`,
    );
    return emptyResponse();
  }
}
