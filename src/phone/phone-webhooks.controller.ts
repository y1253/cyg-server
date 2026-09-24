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
  message,
  pause,
  play,
  record,
  sayAndHangup,
  sayThenDialSip,
  sayThenRecord,
} from './laml.util.js';
import { CallRoutingService } from './call-routing.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { RealtimeTopic } from '../realtime/realtime.types.js';
import { PhoneEventsService } from './phone-events.service.js';
import type { CallEvent } from './phone-events.service.js';
import {
  LEGACY_SIGNATURE_HEADER,
  SIGNATURE_HEADER,
  verifySignature,
} from './signature.util.js';
import {
  recordMode,
  ringMobilesEnabled,
  sipDialTarget,
  webhookBase,
  webhookUrls,
} from './phone.config.js';
import { signAudioToken } from './phone-audio-token.util.js';
import { PhoneAudioService } from '../phone-audio/phone-audio.service.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneSettingsService } from '../phone-settings/phone-settings.service.js';
import { CallSummaryService } from './call-summary.service.js';
import { SmsOptOutService } from './sms-opt-out.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { ConferenceService } from './conference.service.js';
import { RingGroupService } from './ring-group.service.js';
import { ActiveCallsService } from './active-calls.service.js';
import { conferenceDoc } from './conference-laml.util.js';
import { effectiveLeg } from './call-legs.util.js';
import { classifyInboundSms, replyFor } from './sms-keywords.util.js';
import { describeToday, isOpenAt } from '../phone-settings/phone-hours.util.js';
import { renderMessage } from '../phone-settings/phone-message.util.js';
import type { EffectivePhoneSettings } from '../phone-settings/phone-settings.util.js';
import type { CallRoute } from './call-routing.service.js';

/**
 * A webhook field, narrowed to a string.
 *
 * `body` is `Record<string, unknown>`, so `String(body.X ?? '')` would stringify an
 * object to "[object Object]" and hand it on as if it were a phone number.
 */
const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * A webhook field that should be a whole number of seconds, or NULL.
 *
 * ⚠️ Null is the honest answer for absent, blank or unparseable — never 0. A zero
 * duration is a MEANINGFUL value downstream (`outcomeOf` reads `durationSec > 0` as the
 * difference between an answered call and a missed one), so coercing "I was not told"
 * into "it lasted no time" is how a conversation gets filed as a missed call.
 */
const intOrNull = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
};

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
    private readonly optOuts: SmsOptOutService,
    private readonly contacts: ContactsService,
    private readonly conference: ConferenceService,
    private readonly ringGroup: RingGroupService,
    private readonly audio: PhoneAudioService,
    private readonly activeCalls: ActiveCallsService,
    private readonly realtime: RealtimeService,
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

    const from = asString(body.From);
    const to = String(body.To ?? '');
    const callSid = String(body.CallSid ?? '');
    this.logger.log(`inbound call From=${from} To=${to} CallSid=${callSid}`);

    /**
     * ⚠️ IS THIS META, READING A WHATSAPP VERIFICATION CODE ALOUD?
     *
     * When a number cannot be verified by text, Meta is asked to phone it instead — and
     * that call arrives here like any other. Rung through, a robot would ring a member of
     * staff who could do nothing with it. So it is recorded instead, transcribed, and the
     * code taken off it.
     *
     * This sits FIRST, above every other case, and that position is the safety:
     *  - `broadcastIncomingCall` and the ringing registry live inside `ringAndDial`, which
     *    this returns before ever reaching, so no popup and no Answer banner is raised;
     *  - none of the seven documented LaML cases below can be affected, because none of
     *    them has run yet;
     *  - and it costs a map lookup on the hot path, not a query.
     *
     * The gate is narrow and self-expiring: a code must have been requested BY VOICE for
     * this very number, within a window far shorter than the row's own 15-minute deadline,
     * and only a few calls are ever diverted. Outside that, an ordinary caller is
     * untouched — `takeVoiceCodeExpectation` returns null and this whole branch vanishes.
     */
    const expecting = this.events.takeVoiceCodeExpectation(to);
    if (expecting) {
      this.logger.warn(
        `recording an inbound call on ${to} as a WhatsApp verification code (From=${from})`,
      );
      return record({
        action: webhookUrls(process.env).waCodeUrl,
        // Meta's robot reads the code twice and hangs up; 40s covers both readings with
        // room to spare, and the recording is deleted once the code is read off it.
        maxLength: 40,
        // Long enough that the PAUSE between the two readings does not end the recording.
        timeout: 8,
        // ⚠️ A beep is for a human. The robot may start speaking the moment the call is
        // answered, and a beep over the first digits would cost the whole attempt.
        playBeep: false,
      });
    }

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

    // Whose number is this? Resolved ONCE here rather than inside ringAndDial, which is
    // synchronous and must stay that way — it returns the LaML SignalWire is waiting on.
    // Only on the paths that can actually ring somebody: the hang-up paths raise no card.
    const fromName = route
      ? await this.contacts.nameForNumber(route.companyId, from)
      : null;

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
        fromName,
        callSid,
        to,
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
      fromName,
      callSid,
      to,
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
    fromName: string | null,
    callSid: string,
    /** The support number that was called — the busy-line entry is keyed on it. */
    supportNumber: string,
    text: string | null,
    target: string,
    settings: EffectivePhoneSettings,
    voice: string | undefined,
    takeVoicemail: boolean,
  ): string {
    const event: CallEvent = {
      type: 'incoming-call',
      direction: 'inbound',
      companyId: route.companyId,
      companyName: route.companyName,
      from,
      // Omitted rather than sent as null: `fromName` is optional on CallEvent, and an
      // absent key is what every consumer already falls back on.
      ...(fromName ? { fromName } : {}),
      callSid,
      at: Date.now(),
      kind: 'company',
      // Carried ON THE EVENT rather than fetched by the browser. The settings routes are
      // ADMIN-only and the agent being rung usually is not an admin — and this handler
      // has already resolved `settings` anyway, so sending the list costs nothing and
      // adds no route, no guard and no round trip to a screen that has ~30 seconds.
      ...(settings.quickReplies.length
        ? { quickReplies: settings.quickReplies }
        : {}),
    };

    this.events.broadcastIncomingCall(route.targetUserIds, event);

    // The same event, on the channel that survives the office TLS filter.
    //
    // ⚠️ This is the ONE topic that carries a payload rather than a hint to refetch: the
    // softphone needs the CallEvent itself to pair an INVITE, and there is no route to
    // fetch it from that `/phone/pending-calls` does not already serve on a 400ms burst.
    // The audience is the one `broadcastIncomingCall` just used, so this widens nothing.
    this.realtime.publish('ringing', {
      userIds: route.targetUserIds,
      payload: event,
    });
    // The line is now busy for everybody else looking at this company. Here, beside the
    // broadcast, for the same reason the broadcast is here: only these paths ring anyone.
    this.activeCalls.noteInboundRinging({
      companyId: route.companyId,
      supportNumber,
      callSid,
      from,
      fromName,
    });

    this.logger.log(
      `ringing ${route.companyName} -> users [${route.targetUserIds.join(', ')}]` +
        (route.viaAdminFallback ? ' (admin fallback)' : ''),
    );

    /**
     * ── AND, IN PARALLEL, THE ASSIGNEES' OWN MOBILES ─────────────────────────────
     *
     * Deliberately NOT awaited, and deliberately NOT a second noun on the `<Dial>` below.
     * `scripts/signalwire-number-noun-probe.mjs` proved a second noun is discarded silently,
     * so the mobile has to be its own leg — and awaiting it would hold the caller in silence
     * while we talk to SignalWire, when the whole point is that both ring AT ONCE.
     *
     * ⚠️ The `.catch` is not decoration. A `void` on a rejecting promise is an unhandled
     * rejection, which Node exits the process on — the same guard `bustFor` and the summary
     * enqueue carry. `RingGroupService` also never throws; this is the belt.
     *
     * Two gates, in cost order: `ringMobilesEnabled` is the env panic switch (no deploy, no
     * settings edit, and it short-circuits before any DB value is read), then the
     * per-company setting, which defaults OFF. `targetPhones` is empty on the admin-fallback
     * path by construction — see `CallRoutingService`.
     */
    if (
      ringMobilesEnabled(process.env) &&
      settings.ringMobiles &&
      route.targetPhones.length > 0
    ) {
      /**
       * ⚠️ Only ring the cell of somebody who is actually signed in.
       *
       * This is the one place in the codebase where presence decides anything, and
       * `presentForRinging`'s docblock carries the argument for why it is safe HERE and
       * nowhere else: the browser rings regardless of what presence says, and an
       * unanswered call still reaches the company's voicemail, so a false "away" costs
       * this mobile leg and nothing more.
       *
       * The filter is applied to the PHONES, not to `targetUserIds`: who is SHOWN the call
       * is unchanged, because an SSE push at somebody who is not looking is inert, whereas
       * dialling their personal number is not.
       */
      const present = new Set(
        this.events.presentForRinging(route.targetPhones.map((p) => p.userId)),
      );
      const phones = route.targetPhones.filter((p) => present.has(p.userId));
      const skipped = route.targetPhones.filter((p) => !present.has(p.userId));

      if (skipped.length) {
        // Named, because "my phone didn't ring" is otherwise unattributable: the call
        // looks completely normal from every other angle.
        this.logger.log(
          `ring-group ${route.companyName} skipping signed-out user(s) [` +
            `${skipped.map((p) => p.userId).join(', ')}]`,
        );
      }

      if (phones.length > 0) {
        void this.ringGroup
          .start({
            callSid,
            companyId: route.companyId,
            companyName: route.companyName,
            supportNumber,
            from,
            fromName,
            phones,
            ringTimeoutSeconds: settings.ringTimeoutSeconds,
            voice,
            // Whether the caller is hearing a greeting before the `<Dial>` runs. The
            // mobile must wait for it — see `RingGroupService.start`.
            hasGreeting: text !== null,
          })
          .catch(() => undefined);
      }
    }

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
    // `action` is ALWAYS emitted. <Dial> falls through to the next verb when nobody
    // answers -- but it falls through on a NORMAL HANGUP too, so appending <Record>
    // here would play "leave a message" to someone who just finished talking. The
    // action URL is what tells those two apart, using DialCallStatus.
    //
    // It used to be added only when voicemail was on. It is now unconditional because
    // `voice/dial-status` is also where a leg lands when its bridged partner is
    // REDIRECTED away -- which is how add-call moves the root into a conference. With
    // no `action` the leg simply runs out of document and hangs up, i.e. we would drop
    // the customer at the exact moment of adding somebody.
    //
    // Output-equivalent with voicemail off: dial-status resolves
    // `!settings.voicemailEnabled` and returns hangup(), which is precisely what
    // "ran out of document" already did. `laml-probe.mjs` is the check.
    // `X-Cyg-Leg` carries this call's own sid down to the browser as a SIP header, folded
    // into the <Sip> URI by `sipNoun` — which is what `SipTarget.headers` was added for
    // ("this is how the browser learns WHICH company the caller dialled").
    //
    // Call waiting needs it: an agent already on a call holds TWO INVITEs, and `tryPair`
    // otherwise matches whatever INVITE it has against whatever event it has, which can
    // label caller B with company A. With the sid on the INVITE the match is exact.
    //
    // ⚠️ NOT `X-Cyg-Call`, which internal calls already use. An older cached client build
    // compares `(pending.token ?? null) !== markerOf(invitation)` and bails on a mismatch,
    // so reusing that name here would make `null !== '<sid>'` true and break EVERY inbound
    // call for anybody on a stale bundle. This is an installed PWA; that is a real state.
    // A header it does not read is invisible to it.
    //
    // The client treats it as advisory: no marker means fall back to order-based pairing,
    // exactly as today. So if SignalWire turns out not to deliver <Sip> URI parameters as
    // SIP headers — still unverified against the live account — nothing regresses.
    return sayThenDialSip(
      text,
      [{ uri: target, headers: { 'X-Cyg-Leg': callSid } }],
      {
        timeout: settings.ringTimeoutSeconds,
        record: recordMode(process.env),
        voice,
        action: webhookUrls(process.env).dialStatusUrl,
      },
    );
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

    /**
     * ⚠️ FIRST, ABOVE the `completed` check, and WITHOUT any I/O.
     *
     * This is where add-call moves the ROOT leg into its conference, and it is the ONLY
     * thing that moves it. Redirecting the child tears down the `<Dial>` bridge, which
     * lands the root here — so whatever this returns becomes the root's instructions.
     *
     * A `<Dial action>` webhook has no no-op response: `<Hangup/>` kills the leg and an
     * empty `<Response/>` exhausts it just as fatally. That is why the previous
     * "one-shot claim" design dropped live calls — it let this path fall through to the
     * hang-up below while the caller was mid-add. `joinTargetFor` is a pure membership
     * lookup and is safe to answer more than once: during a retry the leg is not in the
     * room, so re-issuing the join cannot pull anybody out.
     *
     * No `await` before the answer: the root is sitting in silence waiting for it.
     */
    const joining = this.conference.joinTargetFor(callSid);
    this.logger.log(
      `dial-status CallSid=${callSid} DialCallStatus='${status}' ` +
        `CallStatus='${body.CallStatus ?? ''}' To=${to} From=${body.From ?? ''} ` +
        `conference=${joining ? joining.room : 'none'} ` +
        // ⚠️ Temporary, and the only way to settle it: NOTHING in this repo has ever
        // verified that SignalWire sends `DialCallDuration`. It is Twilio-documented, and
        // Twilio parity has already been wrong here three times (the signature header,
        // `iso_country`, the purchase-response capabilities). One release of production
        // traffic answers it; record the answer in CLAUDE.md and delete this.
        `keys=${Object.keys(body).join(',')}`,
    );

    if (joining) {
      // ⚠️ Decide on the EFFECTIVE leg. On a forked click-to-call this callback arrives under
      // the POST's sid (the client's), while SignalWire applies our answer to the fork that
      // is executing — the root. Comparing the raw sid would hand the agent's leg a PARTY
      // document: no endConferenceOnExit, and no `record`, so the call would silently stop
      // being recorded the moment somebody was added.
      const leg = effectiveLeg(joining, callSid);
      const role = joining.agentSid === leg ? 'agent' : 'party';
      const isRoot = joining.rootSid === leg;
      this.logger.log(
        `dial-status ${callSid} -> joining ${joining.room} as ${role} isRoot=${isRoot}` +
          (leg !== callSid
            ? ` (callback sid is the client alias of root ${leg})`
            : ''),
      );
      return conferenceDoc({
        room: joining.room,
        role,
        isRoot,
        // No holdUrl: SignalWire fetches it with an empty body, so it could only ever
        // mean silence. See HOLD_AUDIO_NOTE in ConferenceService.
        // ⚠️ No statusCallback here. This response is RETRYABLE, and registering the
        // conference callback from a retried document duplicates every join and leave.
        // It is registered once, from the child's document in ConferenceService.
      });
    }

    /**
     * ⚠️ HERE, and not one line earlier.
     *
     * Above this point sits the conference-join branch, where a `<Dial>` ending means the
     * root is being MOVED INTO A ROOM — the call is not over, `DialCallStatus` there is
     * routinely '' or 'completed', and that response is retryable. Emitting inside it
     * would stamp a live call as ended, repeatedly. The cost of standing below it is that
     * a conferenced internal call gets no push and falls back to `backfillPending`, which
     * is the correct trade and one more reason that backstop stays.
     *
     * Synchronous, and it changes no LaML: every subscriber is fire-and-forget.
     */
    this.events.emitDialCompleted({
      callSid,
      dialCallSid: body.DialCallSid || null,
      dialStatus: status,
      durationSec: intOrNull(body.DialCallDuration),
      to,
    });

    if (status === 'completed') {
      this.logger.log(`dial completed CallSid=${callSid} — no voicemail`);
      return hangup();
    }

    const route = await this.routing.resolve(to);
    const settings = await this.settings.effectiveFor(route?.companyId ?? null);
    if (!route || !settings.voicemailEnabled) {
      // Logged because this branch is what killed three live calls and left NO trace of
      // its own — the only evidence was a warning from CallRoutingService.
      this.logger.log(
        `dial-status ${callSid} -> hangup (${!route ? 'no route' : 'voicemail off'})`,
      );
      return hangup();
    }

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
  /**
   * What a WAITING or HELD conference participant hears.
   *
   * Reached two ways: `waitUrl` on the `<Conference>` noun, and `HoldUrl` on a
   * per-participant hold. Both matter — `setPartyHold` parks somebody on every add.
   *
   * ⚠️ It must NEVER answer with an empty `<Response/>`. That exhausts the document,
   * which drops the participant out of the room — and a URL that 404s does the same
   * thing. Both of those were live in the first version of add-call, which is part of
   * why a room with one participant died in under a second. `<Pause>` is the safe
   * nothing: it ends, SignalWire re-fetches this URL, and the participant loops in
   * silence indefinitely.
   *
   * Reuses the per-company hold track admins already upload rather than inventing a
   * second mechanism. The token is an AUDIO token, not a session token: SignalWire has
   * no session, and putting a member of staff's session token in a URL we hand a third
   * party would be handing out their credentials.
   */
  // ⚠️ Currently UNUSED: no conference document or hold sets waitUrl/HoldUrl any more.
  // SignalWire was observed fetching this with an EMPTY body (no CallSid, no FriendlyName),
  // so it can never identify the company and could only answer silence. Kept, still signed,
  // so a stale document that names it gets a safe answer rather than a 404.
  @Post('voice/conference-wait')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async conferenceWait(
    @Req() req: Request,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    this.assertSigned(req, webhookUrls(process.env).conferenceWaitUrl, body);

    const callSid = body.CallSid ?? '';
    const room = body.FriendlyName ?? '';
    this.logger.log(
      `conference-wait CallSid=${callSid} FriendlyName=${room} ` +
        `Conference=${body.ConferenceSid ?? ''}`,
    );

    try {
      const record = this.conference.recordForLeg(callSid);
      if (record) {
        const effective = await this.settings.effectiveFor(record.companyId);
        const track = await this.audio.resolve(effective.holdAudioId);
        if (track) {
          const base = webhookBase(process.env);
          const url = `${base}/api/phone/audio/${track.id}?token=${signAudioToken(track.id)}`;
          // loop="0" is FOREVER in LaML, not "do not play".
          return play(url, { loop: 0 });
        }
      }
    } catch (err) {
      // Silence beats dropping somebody out of a live conference.
      this.logger.warn(
        `conference-wait ${callSid} fell back to silence: ${String(err)}`,
      );
    }

    return pause(30);
  }

  /**
   * Conference lifecycle events: start, end, join, leave.
   *
   * ── WHY THIS EARNS ITS KEEP ────────────────────────────────────────────────
   * It is the only thing in the system that can say WHICH LEG JOINED WHICH ROOM. Two
   * rounds of debugging add-call were spent without that fact, reconstructing it from
   * timestamps after the event. The log line below is the feature; the bookkeeping is
   * a bonus.
   *
   * Always 200s, even for a room we know nothing about: a 500 makes SignalWire retry and
   * tells us nothing.
   */
  @Post('voice/conference-status')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  conferenceStatusCallback(
    @Req() req: Request,
    @Body() body: Record<string, string>,
  ): string {
    this.assertSigned(req, webhookUrls(process.env).conferenceStatusUrl, body);

    this.logger.log(
      `conference-status event=${body.StatusCallbackEvent ?? ''} ` +
        `ConferenceSid=${body.ConferenceSid ?? ''} ` +
        `FriendlyName=${body.FriendlyName ?? ''} ` +
        `CallSid=${body.CallSid ?? ''} ` +
        `Seq=${body.SequenceNumber ?? ''} ` +
        `Reason=${body.Reason ?? body.ReasonConferenceEnded ?? ''}`,
    );
    this.conference.noteConferenceEvent(body);
    return emptyResponse();
  }

  /**
   * The recording of Meta's WhatsApp verification call.
   *
   * Its OWN route rather than `voice/voicemail`, which would enqueue an AI summary, bust
   * the company's timeline and thank a robot for its message — and has no way to tell the
   * two apart, since `webhookUrls`' docblock rules out distinguishing them with a query
   * string (the signature is computed over the exact URL).
   *
   * ⚠️ This is the FAST path, not the only one. CLAUDE.md records as verified fact that
   * SignalWire does not request a `<Record action>` URL when the caller HANGS UP — which
   * is exactly what Meta's robot does when it finishes reading. So the sweep in
   * `WhatsAppProvisioningService` looks for the recording independently, and this route is
   * the shortcut for when it does fire.
   */
  @Post('voice/wa-code')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  waCode(@Req() req: Request, @Body() body: Record<string, string>): string {
    this.assertSigned(req, webhookUrls(process.env).waCodeUrl, body);

    this.logger.log(
      `whatsapp verification recording To=${body.To ?? ''} ` +
        `sid=${body.RecordingSid ?? '?'} duration=${body.RecordingDuration ?? '?'}s`,
    );
    this.events.emitVoiceCode({
      to: body.To ?? '',
      from: body.From ?? '',
      callSid: body.CallSid ?? '',
      recordingSid: body.RecordingSid || null,
      startedAt: Date.now(),
    });
    // Nothing to say to a robot.
    return hangup();
  }

  /**
   * The screening whisper's keypress, from a staff member's own mobile.
   *
   * ⚠️ `CallSid` here is the MOBILE's leg, not the caller's — this document was handed to
   * that leg by `createCall`. `RingGroupService` indexes its legs precisely so this route
   * can find the call from the only sid it is given.
   *
   * There is deliberately no `voice/screen` sibling: the whisper DOCUMENT rides inline on
   * `createCall`, so only the keypress needs a URL. See `webhookUrls`.
   */
  @Post('voice/screen-accept')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async screenAccept(
    @Req() req: Request,
    @Body() body: Record<string, string>,
  ): Promise<string> {
    this.assertSigned(req, webhookUrls(process.env).screenAcceptUrl, body);

    const legSid = body.CallSid ?? '';
    const digits = body.Digits ?? '';
    this.logger.log(`screen-accept leg=${legSid} digits=${digits || '(none)'}`);
    return this.ringGroup.screenAccept(legSid, digits);
  }

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
   * Call progress — and, on a terminal status, the moment everything that reports on
   * this call is made fresh.
   *
   * It was written as a pure 404-stopper ("nothing acts on it yet"); it is now the one
   * push this system has. A terminal status clears the ringing registry, queues the AI
   * summary, frees the company's line, and runs `freshenFor` — see there for why the
   * order inside it matters. Every one of those is fire-and-forget: SignalWire retries a
   * webhook that is slow to answer.
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

      // Free the company's line if nothing is live on it any more. Not cleared on the sid
      // alone: a forked click-to-call's DEAD twin ends within seconds while the real call
      // carries on, so the registry asks SignalWire before letting anyone dial again.
      void this.activeCalls
        .onTerminalStatus(callSid, asString(body.To), asString(body.From))
        .catch(() => undefined);

      // Make every surface that counts this call fresh, and tell the modules that cache
      // it. Fire-and-forget: a callback must answer fast. See `freshenFor`.
      void this.freshenFor(body, callSid, status).catch(() => undefined);
      return emptyResponse();
    }

    // Non-terminal progress (ringing, answered). Drop the cached timeline window so the
    // change shows up on the next poll rather than after the cache TTL.
    void this.bustFor(body).catch(() => undefined);
    return emptyResponse();
  }

  /**
   * Inbound SMS.
   *
   * Answers the three consumer keywords — STOP, HELP, START — and nothing else; any
   * other message still gets an empty `<Response/>` so SignalWire neither auto-replies
   * nor retries, exactly as before. Two-way texting is a later increment.
   *
   * ⚠️ This is a COMPLIANCE path, not a convenience. Nothing upstream does it for us:
   * SignalWire documents keyword handling as ours, and there is no network-level HELP
   * responder at all — CTIA puts that on the sender, subscribed or not. US carriers do
   * block a sender that keeps messaging after a STOP, but they do it by recording an
   * opt-out violation against the campaign each time, so relying on that is choosing
   * the suspension over the fix.
   *
   * The reply is emitted as LaML `<Message>` rather than a REST send: it rides the
   * response we are already returning, so it costs no extra round-trip and cannot fail
   * separately from the webhook.
   */
  @Post('sms/inbound')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/xml')
  async smsInbound(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): Promise<string> {
    this.assertSigned(req, webhookUrls(process.env).smsUrl, body);

    this.logger.log(
      `inbound SMS From=${String(body.From ?? '?')} To=${String(body.To ?? '?')} ` +
        `media=${String(body.NumMedia ?? '0')}`,
    );

    // For any module that reacts to a text — WhatsApp's number verification reads Meta's
    // code from here. Synchronous, and `emitSms` swallows a subscriber's throw, so it can
    // never change this webhook's reply.
    this.events.emitSms({
      to: asString(body.To),
      from: asString(body.From),
      body: asString(body.Body),
    });

    // The message itself is NOT stored — it lives on SignalWire like every other item
    // in this feed. All that is needed is to drop the cached window, and to say so.
    //
    // ⚠️ The topic is `sms`, not the default `phone`. An inbound text has to reach the
    // BELL and the dashboard badge, and until this existed it reached neither: `bustFor`
    // drops the timeline window only, so `UnreadFeedService`'s own 55s entry went on
    // serving a feed without the new message. `UnreadFeedService` subscribes to this
    // topic for exactly that reason — it cannot be called directly from here, since
    // CommunicationsModule is what imports PhoneModule.
    void this.bustFor(body, 'sms').catch(() => undefined);

    const keyword = classifyInboundSms(body.Body);
    if (!keyword) return emptyResponse();

    const from = String(body.From ?? '');
    // A keyword with no usable sender cannot be recorded against anybody. Reply anyway
    // where a reply is all that is owed (HELP), but never pretend to have stored an
    // opt-out we could not key.
    if (from) {
      try {
        if (keyword === 'stop') {
          await this.optOuts.optOut(from, asString(body.Body).trim());
        } else if (keyword === 'start') {
          await this.optOuts.optIn(from);
        }
      } catch (err) {
        // The list write failing must not swallow the reply: the customer is owed the
        // confirmation we registered either way, and a loud log is what gets this
        // reconciled. It is logged at error precisely because a missed STOP is the one
        // failure here that becomes a carrier violation.
        this.logger.error(
          `sms keyword=${keyword} from=${from} — opt-out write FAILED: ${String(err)}`,
        );
      }
    }

    this.logger.log(`sms keyword=${keyword} from=${from || '?'}`);
    return message(replyFor(keyword));
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

  /**
   * A call is over: make everything that reports on it fresh.
   *
   * ── WHY THIS IS NOT JUST `bustFor` ────────────────────────────────────────────
   * Three separate caches sit between a finished call and what a user sees, and busting
   * only the first left the other two serving the call as still in progress for up to a
   * minute — the reported "it says In progress for ages after I hang up".
   *
   * ⚠️ ORDER IS LOAD-BEARING. `refreshCompanyCounts` recounts by reading back through
   * `loadWindow`, so the bust has to land first or the recount just re-pins the same
   * stale answer it was called to replace.
   *
   * ⚠️ NEVER AWAITED. `refreshCompanyCounts` costs six SignalWire requests; a webhook
   * that waits for them is a webhook SignalWire retries.
   *
   * The emit goes out even when no company resolves (`companyId: null`), because that is
   * every internal staff call — `InternalCallsService` uses it as its backstop trigger
   * for a call that never produced a dial-status push.
   */
  private async freshenFor(
    body: Record<string, unknown>,
    callSid: string,
    status: string,
  ): Promise<void> {
    const companyId = await this.companyFor(body);

    // Both of these are synchronous, and everything below wakes browsers that read
    // straight back through them — so they go first, per `RealtimeService.publish`.
    if (companyId !== null) this.timeline.bust(companyId);
    this.events.emitCallEnded({ callSid, companyId, status });

    // No company means an internal staff call, and nothing here can announce one
    // usefully: it has no window and no company badge, and its two participants are
    // told by `InternalCallsService.writeOutcome`, which is the single point the
    // outcome is actually written. Broadcasting from here would wake the whole firm
    // to refetch a list that only two people's rows changed in.
    if (companyId === null) return;

    // The ROW is already fresh — the window above is gone.
    this.realtime.publish('phone', { companyId });

    // ⚠️ The BADGES are not, and this is the half that gets missed. The missed-call
    // pill, the tab icon and the dashboard counts come from the cross-company counts
    // map, which `refreshCompanyCounts` rewrites by re-reading through the provider —
    // six requests, hundreds of milliseconds. Waking a client before that lands hands
    // it the PRE-CALL numbers and re-pins them, which is the exact staleness this
    // feature exists to remove. So the badge announcement waits for the recount, while
    // the row does not.
    //
    // `finally`, not `then`: a failed recount still leaves the timeline busted, so a
    // refetch is still an improvement on the cached answer.
    void this.timeline
      .refreshCompanyCounts(companyId)
      .catch(() => undefined)
      .finally(() => this.realtime.publish('call-ended', { companyId }));
  }

  /**
   * `topic` is what the client should refresh, not merely which webhook fired: an inbound
   * text has to reach the bell and the dashboard, while a mid-call progress callback only
   * moves the timeline. Defaults to the narrow one.
   */
  private async bustFor(
    body: Record<string, unknown>,
    topic: RealtimeTopic = 'phone',
  ): Promise<void> {
    for (const candidate of [body.To, body.From]) {
      const value = typeof candidate === 'string' ? candidate : '';
      if (!value.startsWith('+')) continue;
      const route = await this.routing.resolve(value);
      if (route) {
        this.timeline.bust(route.companyId);
        this.realtime.publish(topic, { companyId: route.companyId });
        return;
      }
    }
  }
}
