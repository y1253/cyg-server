import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from '../phone/signalwire.service.js';
import { PhoneEventsService } from '../phone/phone-events.service.js';
import { CallControlService } from '../phone/call-control.service.js';
import { CallSummaryService } from '../phone/call-summary.service.js';
import type { CallSummaryView } from '../phone/call-summary.util.js';
import { dialSip } from '../phone/laml.util.js';
import {
  recordMode,
  sipDialTarget,
  webhookUrls,
} from '../phone/phone.config.js';
import { signRecordingToken } from '../phone/recording-token.util.js';
import { isAudibleRecording } from '../phone/phone-timeline.util.js';
import { minRecordingSeconds } from '../phone/phone.config.js';

/**
 * Which slice of the history a request wants.
 *
 * Deliberately the same four names as `InternalFolder` in internal-messages, because the
 * merged workspace inbox drives both sources off ONE folder chip. SENT is mailbox-only —
 * it returns an empty page here, exactly as phone items never reach a company's Sent.
 */
export type InternalCallFolder = 'INBOX' | 'UNCOMPLETED' | 'UNREAD' | 'SENT';

export const INTERNAL_CALL_FOLDERS: InternalCallFolder[] = [
  'INBOX',
  'UNCOMPLETED',
  'UNREAD',
  'SENT',
];

/** Page size, matching internal-messages so one scroll advances both evenly. */
const PAGE_SIZE = 30;

/**
 * Namespace for a call's inbox id.
 *
 * The merged list keys rows, selection and mutations off ONE string id space shared with
 * internal messages, and a bare SignalWire sid is an unprefixed uuid that could collide
 * with nothing today and something tomorrow. Mirrors `swcall:`/`swsms:` in
 * phone-timeline.util.ts, and is deliberately a DIFFERENT prefix: these ids never reach
 * MessageCompletedState / ChatMessageReadState, whose per-company key cannot express a
 * two-participant call with no company.
 */
export const INTERNAL_CALL_ID_PREFIX = 'intcall:';
export const internalCallItemId = (sid: string) =>
  `${INTERNAL_CALL_ID_PREFIX}${sid}`;

/** One row of a user's call history, from their own point of view. */
export interface InternalCallView {
  /** Namespaced inbox id — `intcall:{sid}`. `sid` is still the SignalWire key. */
  id: string;
  sid: string;
  /** Relative to the VIEWER, not to the row. The same call is outbound for one
   *  participant and inbound for the other. */
  direction: 'inbound' | 'outbound';
  peer: { id: number; name: string };
  at: string;
  durationSec: number | null;
  status: string | null;
  outcome: 'answered' | 'missed' | 'in-progress';
  /**
   * Both TRUE for a call you placed, matching how InternalMessageSummary treats a
   * message you sent (`isOwn` forces both). Only the callee side is ever stateful.
   */
  isRead: boolean;
  isCompleted: boolean;
  /**
   * There is audio worth offering a player for. `hasVoicemail` is deliberately ABSENT
   * rather than false: the internal <Dial> has no <Record> fallthrough, so an unanswered
   * internal call leaves nothing behind and the concept does not apply.
   */
  hasRecording: boolean;
}

export interface InternalCallListResult {
  calls: InternalCallView[];
  nextCursor: number | null;
}

export type InternalCallStateAction =
  | 'read'
  | 'unread'
  | 'complete'
  | 'uncomplete';

export interface InternalRecordingView {
  sid: string;
  durationSec: number;
  createdAt: string | null;
  token: string;
}

/** Statuses that mean the two people never spoke. Mirrors UNCONNECTED in the timeline. */
const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);

@Injectable()
export class InternalCallsService {
  private readonly logger = new Logger(InternalCallsService.name);

  /** Seconds the callee's browser rings before SignalWire gives up. */
  private static readonly RING_TIMEOUT = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
    private readonly events: PhoneEventsService,
    private readonly summaries: CallSummaryService,
    private readonly callControl: CallControlService,
  ) {}

  /**
   * Place a call from one member of staff to another.
   *
   * The server originates it rather than the browser sending an INVITE, for the same
   * reason click-to-call does (phone-dialer.service.ts:20-33): every browser registers
   * one shared credential, so a browser-originated INVITE would have to be routed by the
   * SIP endpoint's own call handler — dashboard configuration this project deliberately
   * does not depend on. Asking SignalWire to call US first means the call arrives as an
   * ordinary INVITE and the existing pairing logic works unchanged.
   */
  async startCall(
    callerId: number,
    calleeId: number,
  ): Promise<{ callSid: string; peer: { id: number; name: string } }> {
    // Calling yourself would bridge one browser to itself: the caller's own browser is
    // the only one that would auto-answer, and it cannot answer twice.
    if (callerId === calleeId) {
      throw new BadRequestException('You cannot call yourself');
    }

    const [caller, callee] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: callerId, deletedAt: null },
        select: {
          id: true,
          name: true,
          internalWorkspace: { select: { id: true } },
        },
      }),
      this.prisma.user.findFirst({
        where: { id: calleeId, deletedAt: null },
        select: {
          id: true,
          name: true,
          internalWorkspace: { select: { id: true } },
        },
      }),
    ]);
    if (!caller) throw new NotFoundException('User not found');
    if (!callee)
      throw new NotFoundException('That person is no longer available');

    const target = sipDialTarget(process.env);
    if (!target) {
      this.logger.error(
        'SIGNALWIRE_SIP_* is not configured — no browser can be rung. ' +
          'Set SIGNALWIRE_SIP_DOMAIN / _USERNAME / _PASSWORD in server/.env.',
      );
      throw new ServiceUnavailableException(
        'Softphone is not configured on the server',
      );
    }

    const token = randomUUID();

    // The marker rides on the CALLEE's leg only. Both legs fork to every registered
    // browser and tryPair() does not match on call sid, so without it the callee can
    // answer the caller's own leg. `headers` is folded into the SIP URI by sipNoun().
    const laml = dialSip([{ uri: target, headers: { 'X-Cyg-Call': token } }], {
      timeout: InternalCallsService.RING_TIMEOUT,
      record: recordMode(process.env),
    });

    const call = await this.signalwire.createCall({
      to: `sip:${target}`,
      // No phone number is involved in either direction. `from` must NOT be a company's
      // support number: Calls?From={support} is exactly how that company's timeline is
      // built, so staff calls would surface in a client's feed.
      from: `sip:${target}`,
      laml,
      statusCallback: webhookUrls(process.env).statusCallback,
      timeoutSec: InternalCallsService.RING_TIMEOUT,
    });

    // The row cannot be written first — the sid only exists once the call is created.
    // If this write fails the call is already ringing, and killing a live call to
    // protect a history row is the wrong trade, so log every fact instead and let it
    // proceed: the call still works, it is only unattributable afterwards.
    try {
      await this.prisma.internalCall.create({
        data: { callSid: call.sid, token, callerId, calleeId },
      });
    } catch (err) {
      this.logger.error(
        `internal call placed but NOT recorded: sid=${call.sid} ` +
          `caller=${callerId} callee=${calleeId} — ${String(err)}`,
      );
    }

    this.logger.log(
      `internal call ${caller.name} -> ${callee.name} sid=${call.sid}`,
    );

    // Two DIFFERENT events for one call. Each carries the recipient's OWN internal
    // workspace id as companyId and the OTHER person's name as companyName — which is
    // what those fields mean here: the overlay renders companyName as the call's title
    // and its button navigates to companyId, landing each person in their own workspace
    // where the call history lives -- so CallEvent needed only ONE new optional field,
    // `token`, rather than a discriminated union rippling through every consumer.
    const at = Date.now();
    this.events.broadcastOutgoingCall(callerId, {
      type: 'outgoing-call',
      direction: 'outbound',
      companyId: caller.internalWorkspace?.id ?? 0,
      companyName: callee.name,
      from: caller.name,
      to: callee.name,
      callSid: call.sid,
      at,
    });
    this.events.broadcastIncomingCall([calleeId], {
      type: 'incoming-call',
      direction: 'inbound',
      companyId: callee.internalWorkspace?.id ?? 0,
      companyName: caller.name,
      from: caller.name,
      callSid: call.sid,
      at,
      token,
    });

    return { callSid: call.sid, peer: { id: callee.id, name: callee.name } };
  }

  /**
   * Which rows this folder is asking for.
   *
   * INBOX carries calls in BOTH directions, unlike the messages side where INBOX means
   * "addressed to me" and your own sent mail lives in SENT. A call log that hides the
   * calls you placed is not a call log, and it matches a client company, where outbound
   * calls appear in the inbox feed and phone items never reach Sent.
   *
   * UNREAD / UNCOMPLETED are callee-only by construction: a call you placed projects as
   * read and completed, so it can never match either.
   */
  private folderWhere(folder: InternalCallFolder, userId: number) {
    switch (folder) {
      case 'UNREAD':
        return { calleeId: userId, calleeReadAt: null };
      case 'UNCOMPLETED':
        return { calleeId: userId, calleeCompletedAt: null };
      case 'SENT':
        // Mailbox-only folder. Structurally empty rather than special-cased upstream.
        return { id: -1 };
      default:
        return { OR: [{ callerId: userId }, { calleeId: userId }] };
    }
  }

  /**
   * This user's call history, newest first.
   *
   * Keyset-paginated on `id desc` rather than `startedAt`, mirroring
   * InternalMessagesService.list: `id` is autoincrement so it orders identically and is
   * collision-free for two calls placed in the same millisecond.
   *
   * Costs no SignalWire requests for calls that have already been finalised, which is
   * almost all of them -- see backfillPending for the exception and why it is pulled.
   */
  async list(
    userId: number,
    folder: InternalCallFolder = 'INBOX',
    cursor?: number,
    limit = PAGE_SIZE,
  ): Promise<InternalCallListResult> {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.internalCall.findMany({
      where: this.folderWhere(folder, userId),
      orderBy: { id: 'desc' },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        caller: { select: { id: true, name: true } },
        callee: { select: { id: true, name: true } },
      },
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;

    // Independent of each other, so they overlap rather than serialise.
    const [filled, recorded] = await Promise.all([
      this.backfillPending(page),
      this.recordedSids(),
    ]);

    return {
      calls: page.map((row) => {
        const outbound = row.callerId === userId;
        const peer = outbound ? row.callee : row.caller;
        const patch = filled.get(row.callSid);
        const status = patch?.status ?? row.status;
        const durationSec = patch?.durationSec ?? row.durationSec;
        return {
          id: internalCallItemId(row.callSid),
          sid: row.callSid,
          direction: outbound ? ('outbound' as const) : ('inbound' as const),
          peer: { id: peer.id, name: peer.name },
          at: row.startedAt.toISOString(),
          durationSec,
          status,
          outcome: this.outcomeOf(status, durationSec),
          // A call you placed is yours and therefore done, exactly like a message you
          // sent. Only the callee columns are ever consulted.
          isRead: outbound || row.calleeReadAt != null,
          isCompleted: outbound || row.calleeCompletedAt != null,
          hasRecording: recorded.has(row.callSid),
        };
      }),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Sids that hold audible audio, from ONE account-wide /Recordings page.
   *
   * Per-sid lookups would be one SignalWire request per row on a 15s poll. The
   * account-wide page is the same trick the company timeline uses, and
   * `InternalCall.callSid` IS the leg the <Dial> ran on -- so a direct sid match is
   * enough here, with none of the parent/child walk that company click-to-call needs.
   *
   * Cached just above the poll interval, with an in-flight guard so N open tabs cost one
   * sweep. NEVER throws: a row that renders without a "Recorded" chip is fine, a history
   * list that 500s is not. The detail view still asks SignalWire directly, so a failure
   * here costs a chip, never the audio.
   */
  private recordedCache: { at: number; sids: Set<string> } | null = null;
  private recordedInFlight: Promise<Set<string>> | null = null;
  private static readonly RECORDED_TTL_MS = 30_000;

  private async recordedSids(): Promise<Set<string>> {
    const cached = this.recordedCache;
    if (
      cached &&
      Date.now() - cached.at < InternalCallsService.RECORDED_TTL_MS
    ) {
      return cached.sids;
    }
    if (this.recordedInFlight) return this.recordedInFlight;

    this.recordedInFlight = (async () => {
      try {
        const minSec = minRecordingSeconds(process.env);
        const rows = await this.signalwire.listRecordings({});
        const sids = new Set(
          rows
            .filter(
              (r): r is typeof r & { callSid: string } =>
                !!r.callSid && isAudibleRecording(r, minSec),
            )
            .map((r) => r.callSid),
        );
        this.recordedCache = { at: Date.now(), sids };
        return sids;
      } catch (err) {
        this.logger.warn(
          `could not list recordings for internal call history: ${String(err)}`,
        );
        return this.recordedCache?.sids ?? new Set<string>();
      } finally {
        this.recordedInFlight = null;
      }
    })();
    return this.recordedInFlight;
  }

  /** Unread / uncompleted totals for the workspace folder chips. */
  async counts(
    userId: number,
  ): Promise<{ unread: number; uncompleted: number }> {
    const [unread, uncompleted] = await Promise.all([
      this.prisma.internalCall.count({
        where: { calleeId: userId, calleeReadAt: null },
      }),
      this.prisma.internalCall.count({
        where: { calleeId: userId, calleeCompletedAt: null },
      }),
    ]);
    return { unread, uncompleted };
  }

  /**
   * Flip this viewer's read / completed state on one call.
   *
   * `assertParticipant` first, so a stranger gets the same 404 as everywhere else in this
   * module. The write is then scoped to `calleeId`, which makes it a NO-OP for the caller
   * rather than an error -- the same shape as InternalMessagesService.setState, where a
   * sender has no recipient row to update. A call you placed already projects as read and
   * completed, so there is nothing the request could have meant.
   */
  async setState(
    userId: number,
    callSid: string,
    action: InternalCallStateAction,
  ): Promise<void> {
    await this.assertParticipant(userId, callSid);
    const now = new Date();
    const data =
      action === 'read'
        ? { calleeReadAt: now }
        : action === 'unread'
          ? { calleeReadAt: null }
          : action === 'complete'
            ? { calleeCompletedAt: now }
            : { calleeCompletedAt: null };
    await this.prisma.internalCall.updateMany({
      where: { callSid, calleeId: userId },
      data,
    });
  }

  /**
   * Recordings for one internal call, with a playback token each.
   *
   * The token is minted by `signRecordingToken` and streamed through the existing
   * `GET /api/phone/recordings/:sid?token=` proxy — reused unchanged, so SignalWire's
   * unauthenticated media URL still never reaches a browser.
   */
  async recordings(
    userId: number,
    callSid: string,
  ): Promise<{
    recordings: InternalRecordingView[];
    summary: CallSummaryView | null;
  }> {
    await this.assertParticipant(userId, callSid);
    const rows = await this.signalwire.listRecordings({ callSid });
    // No parent sid to pass: `InternalCall.callSid` IS the leg the <Dial> ran on, which
    // is the leg a recording is filed against and the sid the summary is keyed by. The
    // parent/child split only exists for company click-to-call.
    const summary = await this.summaries.findForCall(callSid);
    return {
      recordings: rows.map((r) => ({
        sid: r.sid,
        durationSec: r.durationSec,
        createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
        token: signRecordingToken(r.sid),
      })),
      summary,
    };
  }

  /**
   * Fill in status and duration for calls that have finished but were never finalised.
   *
   * ── WHY THIS IS PULLED, NOT PUSHED ────────────────────────────────────────────
   * The obvious design is to have the existing voice/status webhook write these fields.
   * That would need PhoneWebhooksController to depend on this service while this module
   * already depends on PhoneModule — a circular import, resolvable only with forwardRef,
   * which trades a clear one-way dependency for a subtle initialisation order.
   *
   * Pulling instead costs one SignalWire request per not-yet-finalised row, which is
   * almost always zero and at most a couple: a row is only pending between the call
   * ending and the next time either participant opens their history. It is also
   * self-healing — a webhook missed during a restart is simply picked up here.
   *
   * Never throws: a history list that renders without a duration is fine; one that 500s
   * is not.
   */
  private async backfillPending(
    rows: { callSid: string; status: string | null; startedAt: Date }[],
  ): Promise<Map<string, { status: string; durationSec: number }>> {
    const filled = new Map<string, { status: string; durationSec: number }>();

    // Only rows with no status yet, and only once they are old enough that a live call
    // is not being mistaken for an unfinalised one.
    const cutoff =
      Date.now() - InternalCallsService.RING_TIMEOUT * 1000 - 5_000;
    const pending = rows.filter(
      (r) => r.status === null && r.startedAt.getTime() < cutoff,
    );
    if (!pending.length) return filled;

    await Promise.all(
      pending.map(async (row) => {
        try {
          const call = await this.signalwire.getCall(row.callSid);
          if (!call) return;
          filled.set(row.callSid, {
            status: call.status,
            durationSec: call.durationSec,
          });
          await this.prisma.internalCall.updateMany({
            where: { callSid: row.callSid },
            data: {
              status: call.status,
              durationSec: call.durationSec,
              endedAt: new Date(),
            },
          });
        } catch (err) {
          this.logger.warn(
            `could not backfill internal call ${row.callSid}: ${String(err)}`,
          );
        }
      }),
    );
    return filled;
  }

  /**
   * THE authorization primitive. An internal call is a private conversation between two
   * people, so only those two may see it — admins included.
   *
   * That is stricter than client-call recordings, where any authenticated user may
   * listen, and deliberately so: it matches internal MESSAGES, where an admin opening
   * another user's workspace gets a 404 on purpose (companies.service.ts).
   *
   * 404 rather than 403, for the same reason assertCallBelongsTo uses one: a 403 would
   * confirm that a call with this sid exists between two other people.
   */
  /**
   * Hand a staff-to-staff call to a third colleague and drop out.
   *
   * Authorization is `assertParticipant`, NOT `assertMayUseCompanyPhone`, and that
   * difference is deliberate: an internal call belongs to two people, not to a company,
   * so an admin who is not on the call gets a 404 exactly as they do for the recordings
   * route. Widening this is one line; un-transferring somebody's private call is not.
   *
   * The `InternalCall` row is also the only thing that can say WHICH leg the requester
   * is on — both legs are the same shared SIP address, so nothing on the legs themselves
   * distinguishes them. That is the whole reason this table exists.
   */
  async transferBlind(
    userId: number,
    callSid: string,
    targetUserId: number,
  ): Promise<{ transferredSid: string }> {
    const row = await this.assertParticipant(userId, callSid);

    const requester = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!requester) throw new NotFoundException('User not found');

    // Neither participant may be the target: handing the call to the person already on
    // it would redirect them to themselves.
    const target = await this.callControl.resolveTarget(targetUserId, userId, [
      row.callerId,
      row.calleeId,
    ]);

    const workspace = await this.prisma.company.findFirst({
      where: { isInternal: true, internalOwnerId: target.id, deletedAt: null },
      select: { id: true },
    });

    return this.callControl.blindTransfer(
      {
        rootSid: callSid,
        kind: 'internal',
        requesterIsCaller: row.callerId === userId,
        requester,
        // An internal CallEvent carries the RECIPIENT's own workspace id and the other
        // person's name, which is what makes the overlay's company row land them where
        // their own history lives. Same convention as startCall.
        companyId: workspace?.id ?? 0,
        companyName: requester.name,
      },
      target,
    );
  }

  private async assertParticipant(userId: number, callSid: string) {
    const row = await this.prisma.internalCall.findFirst({
      where: { callSid, OR: [{ callerId: userId }, { calleeId: userId }] },
    });
    if (!row) {
      this.logger.warn(
        `user ${userId} asked for internal call ${callSid}, which is not theirs`,
      );
      throw new NotFoundException('Call not found');
    }
    return row;
  }

  private outcomeOf(
    status: string | null,
    durationSec: number | null,
  ): InternalCallView['outcome'] {
    if (status === null) return 'in-progress';
    if (UNCONNECTED.has(status)) return 'missed';
    // `completed` with no talk time is a ring-out that the provider still calls
    // completed — the same trap the client-call timeline documents.
    return (durationSec ?? 0) > 0 ? 'answered' : 'missed';
  }
}
