import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { MANAGEMENT_ROLES, Roles } from '../auth/roles.decorator.js';
import { PhoneProvisioningService } from './phone-provisioning.service.js';
import { AttachNumberDto } from './dto/attach-number.dto.js';
import { PhoneEventsService } from './phone-events.service.js';
import { sipCredentials } from './phone.config.js';
import { PhoneTimelineService } from './phone-timeline.service.js';
import { PhoneDialerService } from './phone-dialer.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { SendSmsDto } from './dto/send-sms.dto.js';
import { StartCallDto } from './dto/start-call.dto.js';
import { PhoneItemStateDto } from './dto/phone-item-state.dto.js';
import {
  streamAttachment,
  streamAttachmentFile,
  verifyQueryTokenUser,
} from '../communications/attachment-stream.util.js';
import { assertRecordingToken } from './recording-token.util.js';
import { assertMayUseCompanyPhone } from './company-phone-access.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhoneAudioService } from '../phone-audio/phone-audio.service.js';
import { PhoneSettingsService } from '../phone-settings/phone-settings.service.js';
import { interval, map, merge, Observable, Subject, takeUntil } from 'rxjs';
import type { Request as ExpressRequest, Response } from 'express';

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
  ) {}

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
    verifyQueryTokenUser(token);
    const file = await this.audio.streamable(id);
    await streamAttachmentFile(
      res,
      file.absolutePath,
      file.mimeType,
      file.filename,
      'inline',
      range,
    );
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
  getTimeline(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.timeline.getTimeline(
      companyId,
      before,
      Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 25,
    );
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
    return this.events.getRinging(companyId);
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

  /** Send an SMS from the company's support number. */
  @Post('companies/:companyId/sms')
  @UseGuards(JwtAuthGuard)
  sendSms(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: SendSmsDto,
  ) {
    return this.timeline.sendSms(companyId, dto.to, dto.body);
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

  /** Recordings for one call. 404s unless the call is on this company's number. */
  @Get('companies/:companyId/calls/:sid/recordings')
  @UseGuards(JwtAuthGuard)
  getCallRecordings(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('sid') sid: string,
  ) {
    return this.timeline.getCallRecordings(companyId, sid);
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
  }

  @Patch('companies/:companyId/items/unread')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markUnread(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markChatUnread(companyId, dto.itemId);
  }

  @Patch('companies/:companyId/items/complete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markComplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markComplete(companyId, dto.itemId);
  }

  @Patch('companies/:companyId/items/uncomplete')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markUncomplete(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: PhoneItemStateDto,
  ) {
    await this.state.markUncomplete(companyId, dto.itemId);
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
    await this.timeline.assertCallBelongsTo(companyId, callSid);

    // Everything past here is best-effort. Recording may be switched off entirely
    // (PHONE_RECORD_CALLS=0), or the call may simply not have one yet.
    try {
      const recordings = await this.signalwire.listRecordings({ callSid });
      const live = recordings.find(
        (r) => r.status === 'in-progress' || r.status === 'paused',
      );
      if (!live) return { recordingPaused: false };
      const ok = await this.signalwire.updateRecording(
        callSid,
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
}
