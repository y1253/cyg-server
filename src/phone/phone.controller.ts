import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Logger,
  Patch,
  Req,
  Request,
  Res,
  Sse,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  ServiceUnavailableException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import type { File as MulterFile } from 'multer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
import { PhoneEventsService } from './phone-events.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { sipCredentials, webhookUrls } from './phone.config.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneDialerService } from './phone-dialer.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { SendSmsDto } from './dto/send-sms.dto.js';
import { StartCallDto } from './dto/start-call.dto.js';
import { PhoneItemStateDto } from './dto/phone-item-state.dto.js';
import {
  streamAttachment,
  verifyQueryTokenUser,
} from '../communications/attachment-stream.util.js';
import { ObjectStorageService } from '../storage/object-storage.service.js';
import { streamStoredObject } from '../storage/stored-object.js';
import { assertRecordingToken } from './recording-token.util.js';
import { assertSmsMediaToken } from './sms-media-token.util.js';
import {
  MAX_MMS_FILES,
  MAX_MMS_UPLOAD_BYTES,
  MMS_SUBDIR,
  discardStagedMms,
  mmsImageFileFilter,
} from './mms-staging.util.js';
import { stagedUploadStorage } from '../communications/staged-uploads.js';
import type { StagedMms } from './phone-timeline.service.js';
import { extensionForContentType } from './phone-timeline.util.js';
import { assertMayUseCompanyPhone } from './company-phone-access.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhoneAudioService } from '../phone-audio/phone-audio.service.js';
import { PhoneSettingsService } from '../phone-settings/phone-settings.service.js';
import { CallSummaryService } from './call-summary.service.js';
import { interval, map, merge, Observable, Subject, takeUntil } from 'rxjs';
import type { Request as ExpressRequest, Response } from 'express';
import { CallControlService } from './call-control.service';
import { TransferCallDto } from './dto/transfer-call.dto';
import { AddCallDto, PartyDto, PartyHoldDto } from './dto/conference.dto';
import { ConferenceService } from './conference.service';
import { isAudioTokenFor } from './phone-audio-token.util';
import { agentIsOnRoot, legNumber } from './phone-timeline.util.js';
import { isE164 } from './signalwire-parse.js';
import { QuickReplyDto } from './dto/quick-reply.dto.js';
import { ActiveCallsService } from './active-calls.service.js';
import { toView } from './active-calls.util.js';
import { sayAndHangup, sayThenRecord } from './laml.util.js';
import { describeToday } from '../phone-settings/phone-hours.util.js';
import { renderMessage } from '../phone-settings/phone-message.util.js';

/**
 * Shadows the DOM `MessageEvent`, which carries ~27 fields an SSE payload does not.
 * Same local declaration as `internal-messages.controller.ts`.
 */
interface MessageEvent {
  data: string;
}

/** Matches the internal-messages stream: nginx drops an idle SSE connection at 60s. */
const SSE_HEARTBEAT_MS = 25_000;

@Controller('phone')
export class PhoneController {
  constructor(
    private readonly provisioning: PhoneProvisioningService,
    private readonly events: PhoneEventsService,
    private readonly timeline: PhoneTimelineService,
    private readonly dialer: PhoneDialerService,
    private readonly state: MessageStateService,
    private readonly signalwire: SignalWireService,
    private readonly prisma: PrismaService,
    private readonly audio: PhoneAudioService,
    private readonly settings: PhoneSettingsService,
    private readonly summaries: CallSummaryService,
    private readonly callControl: CallControlService,
    private readonly conference: ConferenceService,
    private readonly activeCalls: ActiveCallsService,
    // ⚠️ APPENDED, not inserted. `phone.controller.spec.ts` builds this class
    // positionally, so adding a parameter anywhere but the end silently shifts every
    // argument in that spec — which is how this arrived, with seven tests failing and a
    // clean typecheck. A trailing parameter is simply `undefined` there instead.
    private readonly storage: ObjectStorageService,
    private readonly realtime: RealtimeService,
  ) {}

  // A field rather than a constructor parameter, for the same positional reason as above.
  private readonly logger = new Logger(PhoneController.name);

  /**
   * The softphone's SIP credentials, for the AUTHENTICATED CALLER.
   *
   * This is what lets the app connect on load with no button and nothing typed.
   *
   * Every user currently gets the same shared credential — SIP passwords cannot be set
   * through any SignalWire API, so a credential per user would mean a manual dashboard
   * entry per user. The route is per-caller anyway so that swapping to per-user
   * credentials later changes only this method's body.
   *
   * Declared above `companies/:companyId/...`: Nest matches in declaration order and a
   * static segment must never sit below a parameterised sibling.
   */
  @Get('sip-credentials')
  @UseGuards(JwtAuthGuard)
  getSipCredentials() {
    const creds = sipCredentials(process.env);
    if (!creds) {
      // A null here means the softphone silently never rings, which is impossible to
      // tell apart from a quiet day — so name it.
      throw new ServiceUnavailableException(
        'Softphone is not configured on the server',
      );
    }
    return creds;
  }

  /**
   * The call ringing this user right now, or null.
   *
   * A NORMAL request, and deliberately so: it is the reliable way to learn which
   * company an INVITE belongs to. See PhoneEventsService.pending — a TLS-intercepting
   * content filter on the office network buffers streaming responses forever, so SSE
   * never delivers there while ordinary requests are unaffected. The client fetches
   * this the moment an INVITE arrives.
   */
  @Get('pending-call')
  @UseGuards(JwtAuthGuard)
  getPendingCall(@Request() req: { user: { userId: number } }) {
    return this.events.takePending(req.user.userId);
  }

  /**
   * EVERY call ringing this user right now, newest first.
   *
   * What call waiting actually needs: an agent already on a call holds two INVITEs, and
   * one event cannot say which company each belongs to. The singular route above is kept
   * beside this one rather than replaced — this is an installed PWA, and a cached client
   * build that only knows `/pending-call` has to keep answering its phone.
   */
  @Get('pending-calls')
  @UseGuards(JwtAuthGuard)
  getPendingCalls(@Request() req: { user: { userId: number } }) {
    return this.events.takeAllPending(req.user.userId);
  }

  /**
   * Per-user push stream for incoming calls. EventSource cannot send headers, hence
   * `?token=`; the token is decoded to a user id rather than merely checked, because
   * this stream carries who is calling which company.
   *
   * MUST stay above any `:param` GET route — Nest matches in declaration order.
   */
  @Sse('events')
  streamEvents(
    @Query('token') token: string,
    @Req() req: ExpressRequest,
  ): Observable<MessageEvent> {
    const userId = verifyQueryTokenUser(token);

    const subject = new Subject<MessageEvent>();
    const clientId = `${userId}-${Date.now()}-${Math.random()}`;
    this.events.addClient(
      clientId,
      userId,
      subject as Subject<{ data: string }>,
    );

    const closed = new Subject<void>();
    req.on('close', () => {
      this.events.removeClient(clientId);
      closed.next();
      closed.complete();
    });

    // Nest writes nothing on an idle SSE stream, so a proxy closes it at its read
    // timeout. The client ignores `ping`.
    const heartbeat = interval(SSE_HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ data: JSON.stringify({ type: 'ping' }) })),
    );
    return merge(subject.asObservable(), heartbeat).pipe(takeUntil(closed));
  }

  /**
   * Streams a call recording's audio.
   *
   * No `@UseGuards`, because this URL is used directly as an `<audio src>` and a media
   * element cannot send an Authorization header.
   *
   * The token is NOT an ordinary session token: it is bound to this specific recording
   * and was minted by the recordings list, which had already established that the call
   * belongs to the caller's company. A plain "is this a valid login" check here would
   * let any authenticated user stream any recording on the whole SignalWire account.
   *
   * ── WHY THIS PROXIES INSTEAD OF REDIRECTING ────────────────────────────────
   * SignalWire serves `/Recordings/{sid}.mp3` with NO authentication at all. Handing
   * that URL to the browser would publish a permanent, unauthenticated link to a
   * client's recorded phone call — to anyone it is ever forwarded to, for as long as
   * the recording exists. Proxying keeps the bytes behind our own auth.
   *
   * `streamAttachment` gives Range/206 handling, which is what makes scrubbing work.
   *
   * Declared above `companies/:companyId/...`: Nest matches in declaration order.
   */
  @Get('recordings/:sid')
  async getRecording(
    @Param('sid') sid: string,
    @Query('token') token: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    assertRecordingToken(token, sid);
    const { buffer, contentType } =
      await this.signalwire.fetchRecordingMedia(sid);
    streamAttachment(
      res,
      buffer,
      contentType,
      `call-${sid}.mp3`,
      'inline',
      range,
    );
  }

  /**
   * One MMS attachment's bytes, proxied.
   *
   * Same shape and the same reasoning as `recordings/:sid` above: SignalWire serves message
   * media with NO authentication, so its URL is a permanent public link to a photo a client
   * sent us and must never reach a browser. The `?token=` is not a session token — it is
   * minted per attachment by the SMS thread, which has already proved the message is in
   * that company's conversation, so one token cannot stream another file.
   *
   * Declared above `companies/:companyId/...`: Nest matches in declaration order.
   */
  @Get('sms-media/:messageSid/:mediaSid')
  async getSmsMedia(
    @Param('messageSid') messageSid: string,
    @Param('mediaSid') mediaSid: string,
    @Query('token') token: string,
    @Query('download') download: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    assertSmsMediaToken(token, messageSid, mediaSid);
    const { buffer, contentType } = await this.signalwire.fetchMessageMedia(
      messageSid,
      mediaSid,
    );
    streamAttachment(
      res,
      buffer,
      contentType,
      `attachment-${mediaSid}${extensionForContentType(contentType)}`,
      download === '1' ? 'attachment' : 'inline',
      range,
    );
  }

  /**
   * Hold-music bytes.
   *
   * Unguarded at the route level so the URL works directly as an audio element src, with
   * the session token in the query string -- the internal-messages attachment pattern.
   * Serves two callers with one route: the admin preview player, and the agent browser
   * that streams this into a live call when Hold is pressed. Both are logged-in sessions,
   * so nothing here is publicly reachable.
   *
   * Declared above the companies/:companyId routes: Nest matches in declaration order.
   */
  @Get('audio/:id')
  async getAudio(
    @Param('id', ParseIntPipe) id: number,
    @Query('token') token: string,
    @Headers('range') range: string,
    @Res() res: Response,
  ) {
    /**
     * EITHER a session token OR an audio token bound to this track.
     *
     * A logged-in browser fetching the hold-music picker carries the first. A conference
     * `waitUrl`/`HoldUrl` is fetched by SIGNALWIRE, which has no session — and handing a
     * third party a member of staff's session token would be handing out their
     * credentials, so that URL carries a token good for this one track and nothing else.
     */
    if (!isAudioTokenFor(token, id)) verifyQueryTokenUser(token);
    const file = await this.audio.streamable(id);
    await streamStoredObject(res, this.storage, file.storageKey, {
      mimeType: file.mimeType,
      filename: file.filename,
      disposition: 'inline',
      range,
    });
  }

  /**
   * Search purchasable numbers. Admin only, because every call hits a paid provider.
   *
   * Declared above the `companies/:companyId/...` routes: Nest matches in declaration
   * order, and a static segment must never sit below a parameterised sibling.
   *
   * Query params are validated in the service rather than by a DTO — the global
   * ValidationPipe does not apply to individually injected @Query values, so a DTO here
   * would be decorative.
   */
  @Get('available')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  searchAvailable(
    @Query('country') country: string,
    @Query('areaCode') areaCode?: string,
  ) {
    return this.provisioning.searchAvailable(country, areaCode);
  }

  /**
   * The company's active support number, or null.
   *
   * Returns null rather than 404-ing, matching `GET /gmail/companies/:id/account`, so
   * the client hook needs no error branch for the ordinary "not connected yet" case.
   */
  /**
   * Which colleagues have a live event stream open right now.
   *
   * JWT-only and ids only — the same read tier as `GET /users/directory`, which the
   * transfer picker already calls for names.
   *
   * Two sources, because an SSE stream alone was wrong for the network this firm runs on:
   * the office TLS-intercepting proxy blackholes SSE entirely — the same filter `pending`
   * and the client's 3s poll exist to work around — so every colleague reported offline.
   * A posted heartbeat is an ordinary request and gets through.
   *
   * `busyUserIds` can ONLY come from the heartbeat. An inbound call rings every browser on
   * one shared SIP credential, so the server is never told who answered; the browser that
   * did is the only thing that knows.
   *
   * ⚠️ STILL ADVISORY ONLY, and more so now that it looks reliable. A user with the app
   * closed is simply absent from both sources, which is indistinguishable here from one
   * whose heartbeat is a second late. Never filter the picker on it, never disable an
   * entry, and never refuse a call or a transfer because of it.
   *
   * Declared above `companies/:companyId/...`: Nest matches in declaration order.
   */
  @Get('presence')
  @UseGuards(JwtAuthGuard)
  async presence(): Promise<{ userIds: number[]; busyUserIds: number[] }> {
    const users = await this.prisma.user.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    return this.events.presenceFor(users.map((u) => u.id));
  }

  /**
   * "I am here, and this is whether I am on a call."
   *
   * Posted by every open app every 20s, and immediately when the busy flag flips. Takes
   * the user from the JWT and nothing from the body but that flag, so one user can never
   * report presence for another.
   */
  @Post('presence')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  heartbeat(
    @Body() body: { busy?: boolean },
    @Request() req: { user: { userId: number } },
  ): { ok: true } {
    this.events.noteHeartbeat(req.user.userId, body?.busy === true);
    return { ok: true };
  }

  @Get('companies/:companyId/number')
  @UseGuards(JwtAuthGuard)
  getNumber(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.provisioning.getActiveNumber(companyId);
  }

  /** Buy a number, point its webhooks at us, and attach it. Admin only. */
  @Post('companies/:companyId/number')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  attachNumber(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: AttachNumberDto,
  ) {
    return this.provisioning.attachNumber(
      companyId,
      dto.phoneNumber,
      dto.region,
    );
  }

  /** Release the number back to SignalWire. Permanent — billing stops. Admin only. */
  @Delete('companies/:companyId/number')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...MANAGEMENT_ROLES)
  @HttpCode(HttpStatus.NO_CONTENT)
  releaseNumber(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.provisioning.releaseNumber(companyId);
  }

  // ── Communications: calls + SMS ─────────────────────────────────────────────

  /**
   * The company's calls and SMS, newest first, merged into one feed.
   *
   * `before` is an ISO timestamp, not an offset. The client interleaves this stream
   * with the email and chat streams, which page independently, so only a time-ordered
   * cursor composes with them — and a timestamp survives a new call arriving between
   * two requests, which an offset would not.
   */
  @Get('companies/:companyId/timeline')
  @UseGuards(JwtAuthGuard)
  async getTimeline(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number.parseInt(limit ?? '', 10);
    const result = await this.timeline.getTimeline(
      companyId,
      before,
      Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25,
    );

    /**
     * The AI one-liner, attached HERE and nowhere deeper.
     *
     * Not in `loadWindow`: that layer is cached for 45s, or five minutes for a historic
     * page, and a summary lands MINUTES after the call — so "no summary yet" would be
     * frozen into the entry long after one existed.
     *
     * Not in `itemsFor` either: that is the shared entry point for `getCounts`,
     * `getUnreadItems` and the cross-company dashboard sweep, none of which render this
     * line, so it would be a DB query per company per sweep for nothing.
     *
     * And not inside `PhoneTimelineService` at all: `CallSummaryService` already injects
     * THAT service, so the reverse edge is a cycle. This controller already holds both,
     * which is what makes the seam free.
     */
    const calls = result.items.filter((i) => i.kind === 'call');
    if (calls.length) {
      const lines = await this.summaries.linesForCalls(
        calls.map((c) => ({ sid: c.sid, parentCallSid: c.parentCallSid })),
      );
      for (const call of calls) call.summaryLine = lines.get(call.sid) ?? null;
    }
    return result;
  }

  /**
   * The call ringing this company right now, or null.
   *
   * Lets an admin who opens a company mid-ring pick the call up, even though the call was
   * routed to the assigned user and this admin got no popup. Their browser already holds
   * a live INVITE — every browser registers the same SIP credential — so all that is
   * missing is knowing which company is calling, which is what this returns.
   *
   * Authorised assigned-user-OR-admin rather than JWT-only like the reads beside it:
   * answering is an action on the company's phone, so it uses the same rule as dialling.
   */
  /**
   * Which track this company uses on hold, as a URL the browser can play.
   *
   * JWT-only, because it is a read (the three-tier rule in company-phone-access.util).
   * It exists as its own route because /api/phone-settings is ADMIN-only and agents are
   * USERs -- the call overlay must not need the admin payload to put someone on hold.
   */
  /**
   * Pause the recording while a caller is on hold, and resume it afterwards.
   *
   * The hold MUSIC is played by the agent browser, not by us -- these two routes exist
   * only so the music does not end up in the recording. That is why they are
   * BEST-EFFORT and always return 200: if SignalWire is slow, recording is switched off
   * entirely, or no in-progress recording exists, the caller must still get their hold
   * music. A silent caller is a worse failure than a recording with music in it.
   *
   * Ordering is the caller’s responsibility and is load-bearing: pause BEFORE starting
   * the music, resume AFTER stopping it. The other order records a slice of music at
   * each boundary, which is the entire defect this exists to prevent.
   */
  @Post('companies/:companyId/calls/:sid/hold')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  hold(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ) {
    return this.setRecordingPaused(companyId, sid, req.user.userId, true);
  }

  @Post('companies/:companyId/calls/:sid/resume')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  resume(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ) {
    return this.setRecordingPaused(companyId, sid, req.user.userId, false);
  }

  /**
   * Send a still-ringing call straight to voicemail — the waiting-call "Decline" button.
   *
   * NOT a local dismissal, and that distinction is the whole reason this route exists.
   * `invitation.reject()` in the browser ends only THIS browser's branch, and every
   * browser registers the same shared SIP credential, so the remaining branches keep the
   * `<Dial>` alive until its 30s timeout and the caller carries on ringing into silence.
   * Redirecting the leg is what actually ends the ring, for everyone.
   *
   * Same "who may act" tier as dialling, holding and answering, plus the per-sid
   * ownership check. `assertCallBelongsTo` is indifferent to how many calls a company has
   * live, so a second inbound call passes it exactly like the first.
   *
   * ⚠️ The consequence to keep in mind: unlike the Communications tab's local-only
   * "Ignore", this takes the call away from every other admin watching that company too.
   * That is the intent — the routed agent is the one deciding — but it is not reversible.
   */
  /**
   * Decline a ringing call AND text the caller back, in one action.
   *
   * ── WHY ONE ROUTE AND NOT TWO CLIENT CALLS ────────────────────────────────────
   * The two halves have to be sequenced, and only the server can do it: send first, then
   * decline. The other order risks the caller being cut off with nothing arriving, which
   * is strictly worse than the plain decline this replaces — and if the TEXT fails there
   * is a real choice to make about whether to decline at all. Here, a failed text means
   * the call is left ringing and the agent is told why, so they can still answer it.
   *
   * ⚠️ The text is chosen from the company's configured `quickReplies`, by INDEX, and
   * never posted as free text. A route that accepted an arbitrary body would be an
   * "send any SMS from any company's number" primitive reachable from a ringing call.
   */
  @Post('companies/:companyId/calls/:sid/decline-with-text')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async declineWithText(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Body() dto: QuickReplyDto,
    @Request() req: { user: { userId: number } },
  ): Promise<{ voicemail: boolean; texted: boolean }> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'reply to a call by text',
    );
    const call = await this.timeline.assertCallBelongsTo(companyId, sid);

    // The caller's own number, from the leg — never from the request body.
    const to = legNumber(call.from) ?? '';
    if (!isE164(to)) {
      throw new BadRequestException(
        'This caller’s number cannot receive a text.',
      );
    }

    const settings = await this.settings.effectiveFor(companyId);
    const template = settings.quickReplies[dto.index];
    if (!template) throw new BadRequestException('No such quick reply');

    // The same renderer the caller-facing messages use, so `{company name}` works and is
    // substituted exactly once.
    const body = renderMessage(template, {
      company: company.businessName,
      phone: legNumber(call.to) ?? '',
      hours: '',
    });

    // ⚠️ TEXT FIRST. A decline is irreversible for every browser holding the call, so if
    // the text cannot be sent the call must still be answerable — the agent is told and
    // decides. `sendSms` throws with an actionable sentence (opted out, no number, the
    // caller is our own support line), which is what surfaces.
    await this.timeline.sendSms(companyId, to, body, []);

    const declined = await this.decline(companyId, sid, req);
    return { ...declined, texted: true };
  }

  @Post('companies/:companyId/calls/:sid/decline')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async decline(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ): Promise<{ voicemail: boolean }> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'decline a call',
    );
    const call = await this.timeline.assertCallBelongsTo(companyId, sid);

    const settings = await this.settings.effectiveFor(companyId);
    const vars = {
      company: company.businessName,
      phone: legNumber(call.to) ?? legNumber(call.from) ?? '',
      hours: describeToday(settings.weeklyHours, settings.timezone, new Date()),
    };
    const voice = settings.voice || undefined;

    // The same two builders `voiceInbound` and `voice/dial-status` use, so a declined
    // caller hears this company's own wording rather than a second, diverging script.
    const laml = settings.voicemailEnabled
      ? sayThenRecord(renderMessage(settings.voicemailPrompt, vars), {
          voice,
          action: webhookUrls(process.env).voicemailUrl,
          maxLength: settings.voicemailMaxSeconds,
          timeout: 10,
          finishOnKey: '#',
        })
      : sayAndHangup(renderMessage(settings.unavailableMessage, vars), {
          voice,
        });

    // THROWS, unlike the hold routes above: a decline that silently did nothing leaves
    // the agent believing the caller was parked while their phone is still ringing.
    await this.signalwire.updateCall(sid, { laml });
    this.logger.log(
      `declined ${sid} for ${company.businessName} -> ` +
        (settings.voicemailEnabled ? 'voicemail' : 'hangup'),
    );

    this.freshenAfterCallEnded(companyId, sid, call, 'declined');

    return { voicemail: settings.voicemailEnabled };
  }

  /**
   * End this call on the provider, not just in this browser.
   *
   * ⚠️ NOT a local dismissal, and that is the whole point — the same argument `decline`
   * makes one route above. The browser's BYE ends the agent's own leg and trusts
   * `<Dial>` to take the other one with it. Verified live, it does not always: an
   * outbound leg to a US number stayed `ringing` for 3.5 hours after its parent
   * completed. Because that leg carries the company's support number,
   * `ActiveCallsService` went on reporting the line busy — so the agent saw "on a call"
   * after hanging up and every further dial was refused with a 409. This ends every live
   * leg explicitly.
   *
   * ⚠️ The client calls this BEFORE its own BYE, not after. The lookup asks SignalWire
   * which legs are live, and after the BYE lands there are none — the same ordering
   * constraint "End & complete" documents in `CallOverlay`.
   *
   * Same "who may act" tier and the same per-sid ownership check as declining,
   * transferring and dialling. `sid` is the ROOT leg the client holds and the only sid
   * authorised here; the legs actually ended are derived inside CallControlService.
   */
  @Post('companies/:companyId/calls/:sid/hangup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async hangUp(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ): Promise<{ ended: string[] }> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'hang up a call',
    );
    const call = await this.timeline.assertCallBelongsTo(companyId, sid);

    const result = await this.callControl.hangUpCall({
      rootSid: sid,
      // Structural, never `direction` — see the note on transferBlind.
      kind: agentIsOnRoot(call) ? 'outbound' : 'inbound',
      requester: { id: req.user.userId, name: '' },
      companyId,
      companyName: company.businessName,
    });

    // So the "on a call" indicator clears on THIS request rather than on the next 30s
    // reconcile. Never throws, and the agent has already hung up regardless.
    await this.activeCalls
      .onTerminalStatus(sid, call.to, call.from)
      .catch(() => undefined);

    // And so does everything else that reports on this call. The agent who pressed the
    // red button is the person most likely to look at the row straight afterwards.
    this.freshenAfterCallEnded(companyId, sid, call, 'hung-up');

    return result;
  }

  /**
   * Hand this call to a colleague and drop out — a blind (cold) transfer.
   *
   * Same "who may act" tier as dialling out and answering: the assigned user, or any
   * admin/manager. Reads are looser (any authenticated user may look at the timeline)
   * and routing is stricter (only the assigned user is RUNG); this sits in the middle,
   * exactly where hold/resume and click-to-call already sit.
   *
   * ⚠️ `sid` is the ROOT leg the client holds, and it is the only sid authorized here.
   * Which leg actually gets redirected is worked out inside CallControlService from the
   * call itself — accepting a leg sid from the client would be a "redirect any call on
   * the account" primitive, since a child leg touches no support number and so would
   * sail past `assertCallBelongsTo` by never being checked at all.
   */
  @Post('companies/:companyId/calls/:sid/transfer/blind')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async transferBlind(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Body() dto: TransferCallDto,
    @Request() req: { user: { userId: number } },
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'transfer a call',
    );
    const call = await this.timeline.assertCallBelongsTo(companyId, sid);

    const requester = await this.prisma.user.findFirst({
      where: { id: req.user.userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!requester) throw new NotFoundException('User not found');

    const target = await this.callControl.resolveTarget(
      dto.targetUserId,
      req.user.userId,
    );

    return this.callControl.blindTransfer(
      {
        rootSid: sid,
        // Asked STRUCTURALLY, not from `direction`. A call taken back from a transfer
        // reports `direction: 'outbound-dial'` while being inbound-SHAPED (root =
        // customer, child = agent), and classifying it 'outbound' would redirect the
        // customer while calling them the agent — see `agentIsOnRoot`. The two rules
        // agree on every call that has not been taken back.
        kind: agentIsOnRoot(call) ? 'outbound' : 'inbound',
        requester,
        companyId,
        companyName: company.businessName,
      },
      target,
    );
  }

  /**
   * "Has my colleague picked up yet?" — polled by the transferring agent's card.
   *
   * `sid` is the ROOT sid, the same one `transferBlind` authorises, so this reuses that
   * guard verbatim rather than inventing a second one over the transferred leg. Which leg
   * is actually inspected is remembered server-side by `CallControlService`.
   */
  @Get('companies/:companyId/calls/:sid/transfer-status')
  @UseGuards(JwtAuthGuard)
  async transferStatus(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'transfer a call',
    );
    await this.timeline.assertCallBelongsTo(companyId, sid);

    return this.callControl.transferStatus(sid);
  }

  // ── Conference: add call, hold, swap, merge, drop ──────────────────────────
  //
  // Six routes, ONE auth recipe, copied verbatim from `transferBlind` above --
  // including the GET, which names live leg states and so takes the "who may act" tier
  // rather than the "who may look" one the read routes beside it use.
  //
  // ⚠️ `sid` is the ROOT leg, and it is the only sid authorised. Every other leg is
  // derived inside ConferenceService, and the client names a person with an opaque
  // `partyId` instead. A child leg touches no support number, so accepting one would
  // sail past assertCallBelongsTo by never being checked at all.

  /** Everything the six share: authorise the caller, then describe the call. */
  private async conferenceContext(
    companyId: number,
    sid: string,
    userId: number,
    action: string,
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');

    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      userId,
      company.businessName,
      action,
    );
    const call = await this.timeline.assertCallBelongsTo(companyId, sid);

    const requester = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!requester) throw new NotFoundException('User not found');

    return {
      rootSid: sid,
      // STRUCTURALLY, never from `direction`: a call taken back from a transfer reports
      // `outbound-dial` while being inbound-shaped, and classifying it wrongly inverts
      // which leg is the agent. See `agentIsOnRoot`.
      kind: agentIsOnRoot(call) ? ('outbound' as const) : ('inbound' as const),
      requester,
      companyId,
      companyName: company.businessName,
    };
  }

  @Post('companies/:companyId/calls/:sid/conference/add')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async conferenceAdd(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Body() dto: AddCallDto,
    @Request() req: { user: { userId: number } },
  ) {
    const ctx = await this.conferenceContext(
      companyId,
      sid,
      req.user.userId,
      'add a person to a call',
    );
    const target =
      dto.targetUserId !== undefined
        ? { userId: dto.targetUserId }
        : dto.phone !== undefined
          ? { phone: dto.phone }
          : dto.contactId !== undefined
            ? { contactId: dto.contactId }
            : null;
    if (!target) {
      throw new BadRequestException('Choose somebody to add to the call');
    }
    return this.conference.addCall(ctx, target);
  }

  @Post('companies/:companyId/calls/:sid/conference/hold')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async conferenceHold(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Body() dto: PartyHoldDto,
    @Request() req: { user: { userId: number } },
  ) {
    const ctx = await this.conferenceContext(
      companyId,
      sid,
      req.user.userId,
      'hold a call',
    );
    return this.conference.setPartyHold(ctx, dto.partyId, dto.held);
  }

  @Post('companies/:companyId/calls/:sid/conference/swap')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async conferenceSwap(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ) {
    const ctx = await this.conferenceContext(
      companyId,
      sid,
      req.user.userId,
      'swap between calls',
    );
    return this.conference.swap(ctx);
  }

  @Post('companies/:companyId/calls/:sid/conference/merge')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async conferenceMerge(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ) {
    const ctx = await this.conferenceContext(
      companyId,
      sid,
      req.user.userId,
      'merge calls',
    );
    return this.conference.merge(ctx);
  }

  @Post('companies/:companyId/calls/:sid/conference/drop')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async conferenceDrop(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Body() dto: PartyDto,
    @Request() req: { user: { userId: number } },
  ) {
    const ctx = await this.conferenceContext(
      companyId,
      sid,
      req.user.userId,
      'drop a person from a call',
    );
    return this.conference.dropParty(ctx, dto.partyId);
  }

  @Get('companies/:companyId/calls/:sid/conference-status')
  @UseGuards(JwtAuthGuard)
  async conferenceStatus(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ) {
    await this.conferenceContext(
      companyId,
      sid,
      req.user.userId,
      'add a person to a call',
    );
    return this.conference.conferenceStatus(sid);
  }

  @Get('companies/:companyId/hold-audio')
  @UseGuards(JwtAuthGuard)
  async holdAudio(@Param('companyId', ParseIntPipe) companyId: number) {
    const effective = await this.settings.effectiveFor(companyId);
    const track = await this.audio.resolve(effective.holdAudioId);
    // Returns the id, not a URL: the browser builds it with its own session token, the
    // way internalAttachmentUrl already does. Echoing a token back that the caller just
    // sent us would be a token round-trip that proves nothing.
    return track ? { audioId: track.id, name: track.name } : { audioId: null };
  }
  @Get('companies/:companyId/ringing')
  @UseGuards(JwtAuthGuard)
  async getRinging(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Request() req: { user: { userId: number } },
  ) {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) return null;
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'answer a call',
    );
    // The viewer id is not a second authorization check — it suppresses the one person
    // who must NOT be offered this call: the agent who just transferred it away. Their
    // browser is holding a fork of the transfer `<Dial>`, so without this the banner
    // invites them to take back the call they deliberately handed over.
    return this.events.getRinging(companyId, req.user.userId);
  }

  /**
   * The call on this company's line right now — whoever is on it, in whichever browser —
   * or null.
   *
   * What lets an admin, or the same user in another tab, see the line is busy and have
   * the call buttons disabled. The same "who may act" tier as dialling: an unassigned USER
   * cannot dial this company, so has nothing to be warned about.
   */
  @Get('companies/:companyId/active-call')
  @UseGuards(JwtAuthGuard)
  async getActiveCall(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Request() req: { user: { userId: number } },
  ) {
    const company = await this.companyForPhone(
      companyId,
      req.user.userId,
      'see the active call',
    );
    if (!company) return null;
    const entry = this.activeCalls.get(companyId);
    return entry ? toView(entry, Date.now(), req.user.userId) : null;
  }

  /**
   * This browser answered an inbound call, so other viewers can see WHO is on it.
   *
   * It can only name the person on a call the server already has an entry for, with the
   * same sid; it can never mark a quiet line busy.
   */
  @Post('companies/:companyId/calls/:sid/answered')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async callAnswered(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ): Promise<void> {
    const company = await this.companyForPhone(
      companyId,
      req.user.userId,
      'answer a call',
    );
    if (!company) throw new NotFoundException('Company not found');
    await this.activeCalls.markAnswered(companyId, sid, req.user.userId);
  }

  /** A live company the requester may use the phone for, or null when it does not exist. */
  private async companyForPhone(
    companyId: number,
    userId: number,
    action: string,
  ): Promise<{ businessName: string } | null> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) return null;
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      userId,
      company.businessName,
      action,
    );
    return company;
  }

  /**
   * Unread / uncompleted phone counts for this company's folder badges — the live,
   * per-company number the open Communications tab shows.
   *
   * The dashboard's cross-company map now carries a phone contribution of its own
   * (`PhoneTimelineService.getUncompletedCountsForAll`), but it is cached for a
   * minute and 30-day windowed. This route stays because the open tab wants the
   * count off the window it is already displaying.
   */
  @Get('companies/:companyId/counts')
  @UseGuards(JwtAuthGuard)
  getCounts(@Param('companyId', ParseIntPipe) companyId: number) {
    return this.timeline.getCounts(companyId);
  }

  /**
   * The whole SMS conversation with one number, oldest first.
   *
   * `peer` is a query param, not a path segment: a leading '+' in a path is a decoding
   * trap, and the same reasoning already puts chat space ids in the query string.
   */
  @Get('companies/:companyId/sms-thread')
  @UseGuards(JwtAuthGuard)
  getSmsThread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('peer') peer: string,
  ) {
    return this.timeline.getSmsThread(companyId, peer ?? '');
  }

  /**
   * Send a text from the company's support number, with or without attachments.
   *
   * Multipart rather than JSON since it gained pictures, and `diskStorage` rather than
   * memory for the reason every large-upload path here gives: a phone photo is several
   * megabytes and there may be three of them. The per-file ceiling is generous because the
   * service SHRINKS rather than refuses — a camera photo is 3-8 MB as a matter of course,
   * and rejecting those would make the feature unusable.
   *
   * ⚠️ On FAILURE the staged files are deleted at once, including anything the shrink path
   * wrote beside them — nothing was sent, so nothing will ever fetch them.
   *
   * On SUCCESS they are deliberately left for the hourly sweep, and that is not laziness:
   * SignalWire FETCHES `MediaUrl` rather than being handed the bytes, and the POST returns
   * as soon as the message is queued. Deleting on the way out of this handler is a race
   * against a download that may not have started — and losing it produces a message that
   * reports `sent`, is billed, and arrives with no picture. The exposure is bounded by the
   * URL's own token, which expires in minutes, long before the sweep.
   */
  @Post('companies/:companyId/sms')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('attachments', MAX_MMS_FILES, {
      storage: stagedUploadStorage(MMS_SUBDIR),
      limits: { fileSize: MAX_MMS_UPLOAD_BYTES, files: MAX_MMS_FILES },
      // Pictures only. An iPhone's default HEIC would otherwise reach `sharp`, fail to
      // decode, and surface as "that picture is too large" — a sentence that is not true
      // and that nobody can act on.
      fileFilter: mmsImageFileFilter,
    }),
  )
  async sendSms(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendSmsDto,
    @UploadedFiles() attachments: MulterFile[] | undefined,
  ) {
    const staged: StagedMms[] = (attachments ?? []).map((file) => ({
      path: file.path,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
      derived: [],
    }));
    try {
      return await this.timeline.sendSms(
        companyId,
        dto.to,
        dto.body ?? '',
        staged,
      );
    } catch (err) {
      await discardStagedMms(staged.flatMap((f) => [f.path, ...f.derived]));
      throw err;
    }
  }

  /**
   * Click-to-call. Rings this user's browser first, then dials out with the company's
   * number as caller ID.
   */
  @Post('companies/:companyId/calls')
  @UseGuards(JwtAuthGuard)
  startCall(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: StartCallDto,
    @Request() req: { user: { userId: number } },
  ) {
    return this.dialer.startCall(companyId, dto.to, req.user.userId);
  }

  /**
   * Recordings for one call, plus its AI summary. 404s unless the call is on this
   * company's number.
   *
   * The summary rides on THIS route rather than getting its own: the ownership check
   * here is exactly the one it needs, and the detail view already makes this request
   * when it opens a call. A separate endpoint would mean a second guard to keep in step
   * with this one, which is how two guards eventually disagree.
   *
   * `parentCallSid` comes from the query because the client already holds it on the row
   * and the row's own sid is NOT what the summary is keyed by for an outbound call —
   * see `summaryLookupSids`.
   */
  @Get('companies/:companyId/calls/:sid/recordings')
  @UseGuards(JwtAuthGuard)
  async getCallRecordings(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Query('parentCallSid') parentCallSid?: string,
  ) {
    const recordings = await this.timeline.getCallRecordings(companyId, sid);
    // Only after the ownership check above has passed.
    const summary = await this.summaries.findForCall(
      sid,
      parentCallSid ?? null,
    );
    return { recordings, summary };
  }

  /**
   * End-of-call bookkeeping: mark the call the agent just finished COMPLETED.
   *
   * ── WHY A ROUTE AND NOT `swcall:{sid}` FROM THE BROWSER ────────────────────────
   * There is deliberately no client-side `swcall:` constructor anywhere in this codebase,
   * and this must not become the first one. The sid the browser holds is the leg its SIP
   * session runs on, which for a click-to-call is the `outbound-api` parent the timeline
   * DROPS — so `swcall:{that sid}` names a row that does not exist, the write lands in
   * `MessageCompletedState` against an id nothing reads back, and the call simply never
   * shows as completed. No error, no log, just a button that does nothing on every
   * outbound call. `rowItemIdForCall` is where that is resolved, once.
   *
   * ⚠️ The client calls this BEFORE hanging up, not after. `rowItemIdForCall` falls back
   * to `pickConnectedChild`, whose candidates are `in-progress` legs — after the BYE lands
   * there are none, and on a forked click-to-call the sid we hold is the dead twin about
   * half the time. Completing while the call is still up is what makes the lookup reliable;
   * the extra second is billed per minute, so it costs nothing.
   *
   * Same "who may act" tier as dialling, holding, declining and transferring, plus the
   * per-sid ownership check — a child leg touches no support number, so leg sids are
   * derived here and never accepted from a client.
   */
  @Post('companies/:companyId/calls/:sid/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async completeCall(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
    @Request() req: { user: { userId: number } },
  ): Promise<{ itemId: string }> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: {
        id: true,
        businessName: true,
        assignments: { select: { userId: true } },
      },
    });
    if (!company) throw new NotFoundException('Company not found');
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      req.user.userId,
      company.businessName,
      'complete a call',
    );

    const { call, supportNumber } =
      await this.timeline.assertCallBelongsToNumber(companyId, sid);
    const itemId = await this.timeline.rowItemIdForCall(call, supportNumber);
    // Loudly, rather than writing against the root and reporting success: a state row
    // nothing reads back is indistinguishable from the feature not working, and the agent
    // would find the call still sitting in their worklist with no idea why.
    if (!itemId) {
      throw new NotFoundException(
        'This call has no inbox row yet — mark it complete from the inbox instead',
      );
    }

    await this.state.markComplete(companyId, itemId);
    // Awaited for the same reason the mark routes await it: the client refetches the
    // dashboard summary as soon as this returns.
    await this.timeline.refreshCompanyCounts(companyId);
    this.timeline.bust(companyId);
    return { itemId };
  }

  /**
   * Per-item read / completed state.
   *
   * Delegates to the same `MessageStateService` the mailbox uses, with namespaced ids
   * — which is what keeps `SupportNumber` the only table this feature adds. The DTO's
   * pattern is load-bearing: these routes write into tables shared with every mailbox,
   * so an unvalidated id here would let a caller mark another company's email complete.
   */
  @Patch('companies/:companyId/items/read')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markChatRead(companyId, dto.itemId);
    // Awaited, not fired: the client refetches the dashboard summary as soon as this
    // returns, and it must get the recounted badge rather than the pre-mark sweep.
    await this.timeline.refreshCompanyCounts(companyId);
    this.realtime.publish('phone-state', { companyId });
  }

  @Patch('companies/:companyId/items/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markChatUnread(companyId, dto.itemId);
    await this.timeline.refreshCompanyCounts(companyId);
    this.realtime.publish('phone-state', { companyId });
  }

  @Patch('companies/:companyId/items/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markComplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markComplete(companyId, dto.itemId);
    await this.timeline.refreshCompanyCounts(companyId);
    this.realtime.publish('phone-state', { companyId });
  }

  @Patch('companies/:companyId/items/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markUncomplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markUncomplete(companyId, dto.itemId);
    await this.timeline.refreshCompanyCounts(companyId);
    this.realtime.publish('phone-state', { companyId });
  }

  /**
   * Shared by hold and resume. Never throws for a provider-side problem.
   *
   * Authorisation is NOT best-effort though: assertMayUseCompanyPhone is the same
   * "who may act" check that dialling and answering use, and assertCallBelongsTo (reused
   * from the timeline service rather than copied -- it compares through legNumber(),
   * which took two attempts to get right) stops a valid session touching a recording on
   * another company’s call.
   */
  private async setRecordingPaused(
    companyId: number,
    callSid: string,
    userId: number,
    paused: boolean,
  ): Promise<{ recordingPaused: boolean }> {
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { businessName: true, assignments: { select: { userId: true } } },
    });
    if (!company) throw new NotFoundException('Company not found');
    await assertMayUseCompanyPhone(
      this.prisma,
      company.assignments,
      userId,
      company.businessName,
      paused ? 'hold a call' : 'resume a call',
    );
    const call = await this.timeline.assertCallBelongsTo(companyId, callSid);

    // Everything past here is best-effort. Recording may be switched off entirely
    // (PHONE_RECORD_CALLS=0), or the call may simply not have one yet.
    try {
      // The recording lives on the root the <Dial record> ran on. On a forked click-to-call
      // the client may hold a DEAD twin of that root, and pausing "its" recording would find
      // nothing — leaving the hold music in the recording. Same resolver as legsFor, and
      // inside this try so an ambiguous result degrades to "not paused", never an error.
      const root = agentIsOnRoot(call)
        ? await this.callControl.resolveLiveRoot(call, `recording ${callSid}`)
        : call;
      const recordings = await this.signalwire.listRecordings({
        callSid: root.sid,
      });
      const live = recordings.find(
        (r) => r.status === 'in-progress' || r.status === 'paused',
      );
      if (!live) return { recordingPaused: false };
      const ok = await this.signalwire.updateRecording(
        root.sid,
        live.sid,
        paused ? 'paused' : 'in-progress',
      );
      return { recordingPaused: ok && paused };
    } catch {
      // Deliberately swallowed: the browser plays the hold music regardless of what
      // happens here, and failing this request would strand the caller in silence.
      return { recordingPaused: false };
    }
  }

  /**
   * A call this browser ended is over: make everything that reports on it agree, now.
   *
   * ── WHY EVERY ONE OF THESE IS HERE ────────────────────────────────────────────
   * None of it ran before, and each omission was separately visible:
   *
   * - `clearRinging` — `ringingByCompany` is otherwise only cleared by the ROOT's own
   *   terminal `voice/status`, which on the DECLINE path does not arrive until the caller
   *   has finished leaving a message. Every other admin watching that company went on
   *   being offered "Answer" for a call that was already dealt with, for minutes.
   * - `bust` then `refreshCompanyCounts` — IN THAT ORDER, because the recount reads back
   *   through the cached window and would otherwise just re-pin the answer it was called
   *   to replace. A declined call becomes a MISSED call, and the missed-call blinker is
   *   precisely what the agent is looking at when they decline; waiting 55s of cache plus
   *   a 60s poll to watch it appear is the reported lag.
   * - `emitCallEnded` — ⚠️ EMITTED, not called. `UnreadFeedService` lives in
   *   CommunicationsModule, which imports PhoneModule, so this controller cannot reach
   *   it; `callEnded$` is the one-way channel it subscribes to in order to drop its 55s
   *   cache, which until now had no invalidation of any kind.
   *
   * `status` is our own word, not a SignalWire one: nothing branches on it, it is for the
   * log. Best-effort and un-awaited throughout — the call has already been ended, and a
   * bookkeeping failure must never surface as an error on an action that worked.
   */
  private freshenAfterCallEnded(
    companyId: number,
    sid: string,
    call: { to: string; from: string },
    status: string,
  ): void {
    this.events.clearRinging(sid);
    void this.activeCalls
      .onTerminalStatus(sid, call.to, call.from)
      .catch(() => undefined);
    this.timeline.bust(companyId);
    this.events.emitCallEnded({ callSid: sid, companyId, status });

    // The row first, then the badges once they are actually recounted — same split and
    // same reason as `PhoneWebhooksController.freshenFor`. This is what turns a decline
    // into an instantly-visible missed call rather than one that appears 55s of cache
    // plus a 60s poll later, which is the lag the docblock above describes.
    this.realtime.publish('phone', { companyId });
    void this.timeline
      .refreshCompanyCounts(companyId)
      .catch(() => undefined)
      .finally(() => this.realtime.publish('call-ended', { companyId }));
  }
}
