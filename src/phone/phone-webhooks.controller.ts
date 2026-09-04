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
import {
  emptyResponse,
  hangup,
  sayAndHangup,
  sayThenDialSip,
  sayThenRecord,
} from './laml.util.js';
import { CallRoutingService } from './call-routing.service.js';
import { PhoneEventsService } from './phone-events.service.js';
import {
  LEGACY_SIGNATURE_HEADER,
  SIGNATURE_HEADER,
  verifySignature,
} from './signature.util.js';
import { recordMode, sipDialTarget, webhookUrls } from './phone.config.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneSettingsService } from '../phone-settings/phone-settings.service.js';
import { CallSummaryService } from './call-summary.service.js';
import { describeToday, isOpenAt } from '../phone-settings/phone-hours.util.js';
import { renderMessage } from '../phone-settings/phone-message.util.js';
import type { EffectivePhoneSettings } from '../phone-settings/phone-settings.util.js';
import type { CallRoute } from './call-routing.service.js';

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
/**
 * Call statuses that mean it is over, one way or another.
 *
 * `completed` is in here even though an inbound call reports it whether or not anyone
 * picked up — either way the ring is finished and nothing should still be offering to
 * answer it.
 */
const TERMINAL_CALL_STATUSES = new Set([
  'completed',
  'canceled',
  'no-answer',
  'busy',
  'failed',
]);

@Controller('phone')
export class PhoneWebhooksController {
  private readonly logger = new Logger(PhoneWebhooksController.name);

  constructor(
    private readonly routing: CallRoutingService,
    private readonly events: PhoneEventsService,
    private readonly timeline: PhoneTimelineService,
    private readonly settings: PhoneSettingsService,
    private readonly summaries: CallSummaryService,
  ) {}

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
   * The shape of the answer is now configuration, not code: business hours, the greeting,
   * the after-hours message and whether an after-hours call still rings are all resolved
   * per company from `PhoneSettingsService` (global defaults, per-company overrides). The
   * signature check, the logging and the content type are unchanged.
   */
  @Post('voice/inbound')
  // Nest answers POST with 201 by default. LaML webhooks are expected to be 200, so
  // this is set explicitly on every route here rather than left to the framework.
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async voiceInbound(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): Promise<string> {
    this.assertSigned(req, webhookUrls(process.env).voiceUrl, body);

    const from = String(body.From ?? '');
    const to = String(body.To ?? '');
    const callSid = String(body.CallSid ?? '');
    this.logger.log(`inbound call From=${from} To=${to} CallSid=${callSid}`);

    // Routing runs BEFORE the SIP check, unlike the previous version. The "nobody is
    // available" wording is per company now, so even a softphone outage should reach the
    // caller in that company's own words. It costs one indexed read on a path that is
    // already failing.
    const route = await this.routing.resolve(to);
    const settings = await this.settings.effectiveFor(route?.companyId ?? null);
    const now = new Date();
    const vars = {
      company: route?.companyName ?? '',
      phone: to,
      hours: describeToday(settings.weeklyHours, settings.timezone, now),
    };
    // '' means "no voice attribute, take the provider default" — see phone settings.
    const voice = settings.voice || undefined;

    /**
     * Voicemail needs somewhere to file the message, so it is offered only when we know
     * WHICH COMPANY was called. An unknown number still just hangs up: a recording that
     * belongs to nobody could never be shown to anyone, and would be billed to store.
     */
    const canTakeVoicemail = !!route && settings.voicemailEnabled;

    /** Play a closing message, then either take a message or hang up. */
    const finish = (message: string) =>
      canTakeVoicemail
        ? sayThenRecord(
            `${message} ${renderMessage(settings.voicemailPrompt, vars)}`,
            {
              voice,
              action: webhookUrls(process.env).voicemailUrl,
              maxLength: settings.voicemailMaxSeconds,
              // Ten seconds of silence ends it: a caller who says nothing has hung up
              // or thought better of it, and we are billed either way.
              timeout: 10,
              finishOnKey: '#',
            },
          )
        : sayAndHangup(message, { voice });

    const unavailable = () =>
      finish(renderMessage(settings.unavailableMessage, vars));

    const target = sipDialTarget(process.env);
    if (!target) {
      this.logger.error(
        'SIGNALWIRE_SIP_* is not configured — no browser can be rung. ' +
          'Set SIGNALWIRE_SIP_DOMAIN / _USERNAME / _PASSWORD in server/.env.',
      );
      return unavailable();
    }

    if (!route || route.targetUserIds.length === 0) {
      // Unknown number, or a company with no assignee and no admins. Say something
      // rather than connecting the caller to silence.
      return unavailable();
    }

    // `hoursEnabled` off means hours are ignored entirely and every call rings — the
    // behaviour that shipped before this feature, and the one-click rollback.
    const open =
      !settings.hoursEnabled ||
      isOpenAt(settings.weeklyHours, settings.timezone, now);

    if (!open) {
      const message = renderMessage(settings.afterHoursMessage, vars);
      if (settings.afterHoursHangUp) {
        this.logger.log(
          `after hours for ${route.companyName} (${settings.timezone}) — ` +
            (canTakeVoicemail
              ? 'message then voicemail'
              : 'message then hangup'),
        );
        return finish(message);
      }
      this.logger.log(
        `after hours for ${route.companyName} (${settings.timezone}) — ` +
          'message then ringing anyway',
      );
      return this.ringAndDial(
        route,
        from,
        callSid,
        message,
        target,
        settings,
        voice,
        canTakeVoicemail,
      );
    }

    const greeting = settings.playGreeting
      ? renderMessage(settings.greetingMessage, vars)
      : null;
    return this.ringAndDial(
      route,
      from,
      callSid,
      greeting,
      target,
      settings,
      voice,
      canTakeVoicemail,
    );
  }

  /**
   * Announce the call to the browsers that should see it, and hand SignalWire the LaML
   * that rings them.
   *
   * ── INVARIANT: THE BROADCAST AND THE <Dial> LIVE TOGETHER ──────────────────────
   * `broadcastIncomingCall` fires on exactly the paths whose LaML contains a `<Dial>`,
   * which is why both happen here and nowhere else. It must NEVER be hoisted above the
   * open/closed branch in `voiceInbound`: broadcasting on the hang-up path raises a
   * ringing popup and an in-tab Answer banner for a call SignalWire is already ending,
   * and `voice/status` would then be the only thing that clears `ringingByCompany` —
   * leaving a phantom Answer button in every admin's browser for up to the 40s TTL.
   *
   * The SSE push is what makes the popup possible at all: every browser shares one SIP
   * credential, so the INVITE identifies nobody and carries no company. This says which
   * company is calling and who should be shown it. Sent BEFORE returning the LaML so it
   * is in flight while SignalWire sets up the call leg.
   */
  private ringAndDial(
    route: CallRoute,
    from: string,
    callSid: string,
    text: string | null,
    target: string,
    settings: EffectivePhoneSettings,
    voice: string | undefined,
    takeVoicemail: boolean,
  ): string {
    this.events.broadcastIncomingCall(route.targetUserIds, {
      type: 'incoming-call',
      direction: 'inbound',
      companyId: route.companyId,
      companyName: route.companyName,
      from,
      callSid,
      at: Date.now(),
    });

    this.logger.log(
      `ringing ${route.companyName} -> users [${route.targetUserIds.join(', ')}]` +
        (route.viaAdminFallback ? ' (admin fallback)' : ''),
    );

    // ONE target: every browser registers the same credential, so a single <Sip> noun
    // reaches all of them. With per-user credentials this would become one noun per
    // user id — the only place that choice shows up.
    //
    // `record` is what makes the recording available on the call's row in the
    // Communications tab afterwards. It is applied to the outbound bridge too, so both
    // directions are recorded; recording one side only would leave half the timeline
    // with a player that never has anything to play. It stays env-driven rather than
    // per-company: recording is a billing and consent switch, not a preference.
    //
    // `text: null` makes this byte-identical to the previous dialSip() call, so turning
    // the greeting off is a no-op rather than an empty <Say>.
    //
    // `action` is added ONLY when voicemail is on. <Dial> falls through to the next verb
    // when nobody answers -- but it falls through on a NORMAL HANGUP too, so appending
    // <Record> here would play "leave a message" to someone who just finished talking.
    // The action URL is what tells those two apart, using DialCallStatus. With voicemail
    // off no attribute is emitted and the output is byte-identical to before.
    return sayThenDialSip(text, [{ uri: target }], {
      timeout: settings.ringTimeoutSeconds,
      record: recordMode(process.env),
      voice,
      action: takeVoicemail
        ? webhookUrls(process.env).dialStatusUrl
        : undefined,
    });
  }

  /**
   * Where a <Dial> ends up, when voicemail is enabled.
   *
   * THE WHOLE POINT: <Dial> hands control here whether nobody answered OR the agent
   * finished a normal conversation and hung up. Only DialCallStatus distinguishes them.
   * Getting this wrong plays "please leave a message" to a customer who has just spent
   * ten minutes talking to us, so the check is written positively -- anything that is
   * not an explicit `completed` is treated as unanswered, and the caller is offered
   * voicemail rather than dropped.
   */
  @Post('voice/dial-status')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async dialStatus(
    @Req() req: Request,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    this.assertSigned(req, webhookUrls(process.env).dialStatusUrl, body);

    const status = body.DialCallStatus ?? '';
    const to = body.To ?? '';
    const callSid = body.CallSid ?? '';

    if (status === 'completed') {
      this.logger.log(`dial completed CallSid=${callSid} — no voicemail`);
      return hangup();
    }

    const route = await this.routing.resolve(to);
    const settings = await this.settings.effectiveFor(route?.companyId ?? null);
    if (!route || !settings.voicemailEnabled) return hangup();

    const vars = {
      company: route.companyName,
      phone: to,
      hours: describeToday(settings.weeklyHours, settings.timezone, new Date()),
    };
    this.logger.log(
      `dial ${status || 'unknown'} CallSid=${callSid} — offering voicemail`,
    );
    return sayThenRecord(renderMessage(settings.voicemailPrompt, vars), {
      voice: settings.voice || undefined,
      action: webhookUrls(process.env).voicemailUrl,
      maxLength: settings.voicemailMaxSeconds,
      timeout: 10,
      finishOnKey: '#',
    });
  }

  /**
   * A finished voicemail.
   *
   * The audio is already stored on SignalWire by the time this fires, so there is
   * nothing to save -- the timeline reads it back from /Recordings like every other
   * recording. This exists to bust the cached timeline window so the message shows up
   * in the Communications tab now rather than after the cache expires, and to say
   * goodbye instead of dropping the line silently.
   */
  @Post('voice/voicemail')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async voicemail(
    @Req() req: Request,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    this.assertSigned(req, webhookUrls(process.env).voicemailUrl, body);

    this.logger.log(
      `voicemail CallSid=${body.CallSid ?? ''} ` +
        `duration=${body.RecordingDuration ?? '?'}s ` +
        `sid=${body.RecordingSid ?? '?'}`,
    );
    // `.catch` is not decoration: `void` on a rejecting promise is an UNHANDLED rejection,
    // which Node exits the process on. The other two bustFor call sites already guard it;
    // this one did not, on the single route that fires at the end of every voicemail.
    void this.bustFor(body).catch(() => undefined);

    // The ONLY handler handed a RecordingSid directly, so the summary worker can skip
    // its lookup entirely. It is also the case where a summary is worth most: a message
    // someone left is exactly the thing you want to read rather than play.
    void this.enqueueSummary(body.CallSid ?? '', body).catch(() => undefined);

    const route = await this.routing.resolve(body.To ?? '');
    const settings = await this.settings.effectiveFor(route?.companyId ?? null);
    return sayAndHangup('Thank you. Goodbye.', {
      voice: settings.voice || undefined,
    });
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

    const callSid = String(body.CallSid ?? '');
    const status = String(body.CallStatus ?? '?');
    this.logger.log(
      `call status CallSid=${callSid || '?'} ` +
        `status=${status} ` +
        `duration=${String(body.CallDuration ?? '0')}s`,
    );

    // Stop offering "Answer" for a call that is over. Without this the in-tab ringing
    // banner would keep a dead call on screen until its TTL expired — the client's own
    // Terminated listener covers a browser whose branch was cancelled, but not one that
    // is merely reading the endpoint.
    if (callSid && TERMINAL_CALL_STATUSES.has(status)) {
      this.events.clearRinging(callSid);

      // Queue an AI summary for this call. THIS is the trigger for all three kinds of
      // call, because all three set this same StatusCallback: the number itself for
      // inbound (phone-provisioning), and explicitly on POST /Calls for click-to-call
      // (phone-dialer) and staff-to-staff (internal-calls). One trigger, no branching.
      //
      // Only a row is written — the recording does not even exist yet at this point, and
      // a webhook must answer fast. The cron in CallSummaryService does the work.
      // Fire-and-forget with the same `.catch` guard as `bustFor` below: `void` on a
      // rejecting promise is an unhandled rejection, which Node exits the process on.
      void this.enqueueSummary(callSid, body).catch(() => undefined);
    }

    // Drop the cached timeline window so the finished call shows up on the next poll
    // rather than after the cache TTL. Fire-and-forget: a callback must answer fast,
    // and a stale window is a cosmetic delay, not a fault.
    void this.bustFor(body).catch(() => undefined);
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
      `inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')} ` +
        `media=${String(body.NumMedia ?? '0')}`,
    );

    // The message itself is NOT stored — it lives on SignalWire like every other item
    // in this feed. All that is needed is to drop the cached window so the next poll
    // (15s) picks it up instead of waiting out the TTL.
    void this.bustFor(body).catch(() => undefined);
    return emptyResponse();
  }

  /**
   * Invalidate the cached timeline for whichever company this callback concerns.
   *
   * `To` is our support number on an inbound call or message; on a status callback for
   * an outbound leg it is the customer, so `From` is tried as well. A miss is harmless
   * — it just means the row waits for the ordinary cache expiry.
   */
  /**
   * Queue a finished call for summarisation.
   *
   * The company is resolved the same way `bustFor` does, and a MISS IS FINE: an internal
   * staff-to-staff call has SIP addresses on both legs and belongs to no company, which
   * is exactly what a null `companyId` records.
   */
  private async enqueueSummary(
    callSid: string,
    body: Record<string, unknown>,
  ): Promise<void> {
    if (!callSid) return;
    const recordingSid =
      typeof body.RecordingSid === 'string' && body.RecordingSid
        ? body.RecordingSid
        : null;
    await this.summaries.enqueue({
      callSid,
      companyId: await this.companyFor(body),
      recordingSid,
    });
  }

  /** The company a callback concerns, or null. Shared by `bustFor` and the summary queue. */
  private async companyFor(
    body: Record<string, unknown>,
  ): Promise<number | null> {
    for (const candidate of [body.To, body.From]) {
      const value = typeof candidate === 'string' ? candidate : '';
      if (!value.startsWith('+')) continue;
      const route = await this.routing.resolve(value);
      if (route) return route.companyId;
    }
    return null;
  }

  private async bustFor(body: Record<string, unknown>): Promise<void> {
    for (const candidate of [body.To, body.From]) {
      const value = typeof candidate === 'string' ? candidate : '';
      if (!value.startsWith('+')) continue;
      const route = await this.routing.resolve(value);
      if (route) {
        this.timeline.bust(route.companyId);
        return;
      }
    }
  }
}
