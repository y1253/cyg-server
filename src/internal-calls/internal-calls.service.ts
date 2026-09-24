import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Subscription } from 'rxjs';
import { PrismaService } from '../prisma/prisma.service.js';
import { SignalWireService } from '../phone/signalwire.service.js';
import {
  PhoneEventsService,
  type CallEnded,
  type CallEvent,
  type DialCompleted,
} from '../phone/phone-events.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { CallControlService } from '../phone/call-control.service.js';
import { ConferenceService } from '../phone/conference.service.js';
import { CallSummaryService } from '../phone/call-summary.service.js';
import type { CallSummaryView } from '../phone/call-summary.util.js';
import { dialSip } from '../phone/laml.util.js';
import {
  recordMode,
  sipDialTarget,
  webhookUrls,
} from '../phone/phone.config.js';
import { signRecordingToken } from '../phone/recording-token.util.js';
import {
  LIVE,
  UNCONNECTED,
  isAudibleRecording,
} from '../phone/phone-timeline.util.js';
import {
  IMPLICITLY_READ_SQL,
  isImplicitlyReadInternalCall,
} from './internal-call-read.util.js';
import { pickConnectedChild } from '../phone/call-legs.util.js';
import type { SwCall } from '../phone/signalwire-parse.js';
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
  /**
   * The status of the leg that DECIDED the outcome — the child leg that reached a
   * person, not the root.
   *
   * ⚠️ So this is NOT what `getCall(sid)` returns for this sid. The root is an
   * `outbound-api` leg whose `<Dial>` completes whether or not anybody picks up, so it
   * reports `completed` on a call that rang out. See `backfillPending`.
   */
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
  /**
   * The AI one-liner, for the row itself. Null until the summary worker gets to it, and
   * always null when PHONE_SUMMARIZE_CALLS is off.
   *
   * Unlike the company side's `parentCallSid` dance, an internal call needs no parent
   * lookup: `InternalCall.callSid` IS the leg the `<Dial>` ran on, which is the sid a
   * CallSummary row is keyed by.
   */
  summaryLine: string | null;
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

@Injectable()
export class InternalCallsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InternalCallsService.name);

  private subs: Subscription[] = [];

  /** Seconds the callee's browser rings before SignalWire gives up. */
  private static readonly RING_TIMEOUT = 30;

  /**
   * How long a finished call may show no child legs before we conclude there were none.
   *
   * Child rows appear within seconds, so this is pure insurance against provider lag: the
   * cost of concluding too early is a permanently wrong "missed" on a call somebody
   * answered, and the cost of waiting is one more list read before the row settles.
   */
  private static readonly CHILD_LEG_GRACE_MS = 5 * 60_000;

  /**
   * How long `writeOutcome` waits before retrying a row that did not exist yet.
   *
   * `startCall` creates the row after `POST /Calls` returns, so an outcome pushed very
   * early can beat it by a few milliseconds. Short, because the write is already in
   * flight — this is a race, not a queue.
   */
  private static readonly ROW_RACE_RETRY_MS = 750;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
    private readonly events: PhoneEventsService,
    private readonly summaries: CallSummaryService,
    private readonly callControl: CallControlService,
    private readonly conference: ConferenceService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * ⚠️ `onModuleInit`, NEVER the constructor.
   *
   * This service's spec builds it with `new` and a hand-rolled `events` mock that has no
   * subjects on it. A constructor subscription would throw there and take every test in
   * that file with it — and the failure would look like a test-harness problem rather
   * than what it is.
   */
  onModuleInit(): void {
    this.subs.push(
      this.events.dialCompleted$.subscribe((e) => {
        void this.settleFromDial(e).catch(() => undefined);
      }),
      this.events.callEnded$.subscribe((e) => {
        void this.settleNow(e).catch(() => undefined);
      }),
    );
  }

  onModuleDestroy(): void {
    for (const sub of this.subs) sub.unsubscribe();
    this.subs = [];
  }

  /** Settled = we know how this call ended. NULL and a LIVE status both mean we do not. */
  private isSettled(status: string | null): boolean {
    return status !== null && !LIVE.has(status);
  }

  /**
   * Write the outcome the instant the `<Dial>` reports it, rather than waiting for a
   * history read to go looking for child legs.
   *
   * ── WHY THIS IS THE PRIMARY PATH AND `backfillPending` IS NOW THE BACKSTOP ──────
   * `DialCallStatus` is the provider's own answer to "did the dialled party pick up",
   * and it arrives the moment the bridge tears down. `backfillPending` has to reconstruct
   * that from child legs, only runs when somebody opens their history, and cannot even
   * start until the row is 35 seconds old — so a ten-second staff call read "In progress"
   * for the better part of a minute. It also resolves the forked-leg case for free: every
   * browser shares one SIP credential, so a `<Dial><Sip>` forks, and SignalWire collapses
   * the fork into one status where we were picking a winner by hand.
   *
   * ⚠️ `dialCompleted$` fires for EVERY call, company ones included. The `findUnique` on
   * `callSid` (which is `@unique`) is what makes this a no-op for those — do not try to
   * pre-filter on `to` being a sip: URI, because an internal call's `To` shape is not this
   * module's to assume.
   *
   * ⚠️ NEVER writes `completed` without a positive duration. `outcomeOf` reads
   * `durationSec > 0` as the difference between answered and missed, and
   * `IMPLICITLY_READ_SQL` reads the same pair — so `('completed', 0)` is a PERMANENTLY
   * wrong "missed, unread" that nothing revisits, which is the exact bug this whole change
   * exists to remove. When the duration cannot be established, write nothing and let the
   * backstop reason from the child legs.
   */
  private async settleFromDial(e: DialCompleted): Promise<void> {
    if (!e.callSid || !e.dialStatus) return;

    const row = await this.prisma.internalCall.findUnique({
      where: { callSid: e.callSid },
      select: { status: true },
    });
    // Not a staff call, or already settled (a retried callback, or the backstop won).
    if (!row || this.isSettled(row.status)) return;

    const durationSec = await this.dialDuration(e);
    if (e.dialStatus === 'completed' && durationSec === null) {
      this.logger.warn(
        `internal call ${e.callSid}: dial completed but no duration could be ` +
          `established (DialCallDuration absent, DialCallSid=${e.dialCallSid ?? 'none'}) ` +
          `— leaving it for backfillPending`,
      );
      return;
    }

    await this.writeOutcome(
      e.callSid,
      e.dialStatus,
      durationSec ?? 0,
      'dial-status',
    );
  }

  /**
   * How long the dialled party was actually connected, or null if it cannot be known.
   *
   * ⚠️ `DialCallDuration` is UNVERIFIED against this account — nothing in this repo has
   * ever observed one, and Twilio parity has already been wrong here three times. So it
   * is used when present and there is a real fallback when it is not: `DialCallSid` names
   * the dialled leg, and that leg knows its own duration. An UNCONNECTED status needs
   * neither — nobody was on the line, so zero is not a guess.
   */
  private async dialDuration(e: DialCompleted): Promise<number | null> {
    if (e.durationSec !== null) return e.durationSec;
    if (e.dialStatus !== 'completed') return 0;
    if (!e.dialCallSid) return null;
    try {
      const leg = await this.signalwire.getCall(e.dialCallSid);
      return leg ? leg.durationSec : null;
    } catch (err) {
      this.logger.warn(
        `could not read dialled leg ${e.dialCallSid}: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * The backstop trigger: a call reached a terminal status and never produced a usable
   * dial-status push — a conferenced call (whose dial-status is a JOIN, not an ending),
   * or a `completed` whose duration could not be established.
   *
   * Runs the SAME child-leg rule `backfillPending` runs, with its 35-second age gate
   * bypassed: the gate exists to avoid mistaking a live call for an unfinalised one, and
   * a terminal status is proof it is not live.
   */
  private async settleNow(e: CallEnded): Promise<void> {
    if (!e.callSid) return;
    const row = await this.prisma.internalCall.findUnique({
      where: { callSid: e.callSid },
      select: { callSid: true, status: true, startedAt: true },
    });
    if (!row || this.isSettled(row.status)) return;
    await this.settleOne(row);
  }

  /**
   * A participant's browser says the call is over.
   *
   * ── WHY THE BROWSER IS TRUSTED HERE, AND NOWHERE ELSE ──────────────────────────
   * Every provider-driven path can silently decline to write, and on the commonest
   * ending they all do:
   *   - `settleFromDial` never runs — SignalWire does not request a `<Dial action>` URL
   *     when the leg running the `<Dial>` is the one that hung up;
   *   - `settleOne` finds no child legs and bails for `CHILD_LEG_GRACE_MS` (5 minutes)
   *     with nothing scheduling a retry;
   *   - `backfillPending` is pull-only and gated on `startedAt`, so it ignores a call
   *     under ~35s old however definitively it has ended.
   * Measured in production: rows settled 5m51s, 5m57s and 12m36s after the call, every
   * one of them as `no-answer`/0 — i.e. a conversation that really happened was filed as
   * MISSED, five minutes late. Until then it reads "In progress", which is the report.
   *
   * The two browsers are the participants. They hold the SIP session, so they know
   * whether it was answered and for how long — strictly better than a root leg that
   * reported `no-answer`/0 for calls that demonstrably took place.
   *
   * ⚠️ Only while the row is UNSETTLED. A provider outcome that already landed wins,
   * which also makes this idempotent when both participants report the same ending.
   *
   * ⚠️ `assertParticipant` first, so a stranger gets the same 404 as everywhere else in
   * this module — an outsider must not be able to stamp an outcome on other people's call.
   */
  async reportEnded(
    userId: number,
    callSid: string,
    input: { answered: boolean; durationSec: number },
  ): Promise<void> {
    const row = await this.assertParticipant(userId, callSid);
    if (this.isSettled(row.status)) return;

    // `completed` and `no-answer` are the two the rest of this module already reasons
    // about: `UNCONNECTED` contains `no-answer`, so `outcomeOf` reads it as missed, and
    // `completed` with a positive duration reads as answered. Nothing new to teach it.
    const answered = input.answered && input.durationSec > 0;
    await this.writeOutcome(
      callSid,
      answered ? 'completed' : 'no-answer',
      answered ? input.durationSec : 0,
      `browser outcome (user ${userId})`,
    );
  }

  /** One write, one log line, one place the row's outcome is stamped. */
  private async writeOutcome(
    callSid: string,
    status: string,
    durationSec: number,
    source: string,
  ): Promise<void> {
    const res = await this.prisma.internalCall.updateMany({
      where: { callSid },
      data: { status, durationSec, endedAt: new Date() },
    });
    if (res.count === 0) {
      // `startCall` writes its row AFTER `createCall` returns, deliberately, so a fast
      // push can arrive first.
      //
      // ⚠️ This used to log and give up, which DISCARDS the outcome and skips the publish
      // below — the row then falls back to the slow archaeology this method exists to
      // pre-empt. One short retry costs nothing and closes the window, since the missing
      // write is only ever milliseconds away.
      this.logger.warn(
        `internal call ${callSid}: ${source} outcome arrived before the row existed — retrying`,
      );
      await new Promise((r) =>
        setTimeout(r, InternalCallsService.ROW_RACE_RETRY_MS),
      );
      const retry = await this.prisma.internalCall.updateMany({
        where: { callSid },
        data: { status, durationSec, endedAt: new Date() },
      });
      if (retry.count === 0) {
        this.logger.warn(
          `internal call ${callSid}: ${source} outcome dropped, row still absent`,
        );
        return;
      }
    }

    // The call just stopped being "In progress". Both participants' inboxes, counts and
    // bell rows are derived from this row, so both are told — `updateMany` does not hand
    // back the ids, hence the second read. Best-effort: the outcome is already written,
    // and a notification failure must not undo it.
    const row = await this.prisma.internalCall
      .findUnique({
        where: { callSid },
        select: { callerId: true, calleeId: true },
      })
      .catch(() => null);
    if (row) {
      this.realtime.publish('internal-call', {
        userIds: [row.callerId, row.calleeId],
      });
    }
  }

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
      // Same reason as the dialer: a leg whose partner is redirected into a conference
      // must have somewhere to go. `To` here is a SIP URI, so dial-status finds no
      // company and returns hangup() -- unchanged for an ordinary staff call.
      action: webhookUrls(process.env).dialStatusUrl,
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
    const callerEvent: CallEvent = {
      type: 'outgoing-call',
      direction: 'outbound',
      companyId: caller.internalWorkspace?.id ?? 0,
      companyName: callee.name,
      from: caller.name,
      to: callee.name,
      callSid: call.sid,
      at,
      kind: 'internal',
    };
    const calleeEvent: CallEvent = {
      type: 'incoming-call',
      direction: 'inbound',
      companyId: callee.internalWorkspace?.id ?? 0,
      companyName: caller.name,
      from: caller.name,
      callSid: call.sid,
      at,
      token,
      kind: 'internal',
    };
    this.events.broadcastOutgoingCall(callerId, callerEvent);
    this.events.broadcastIncomingCall([calleeId], calleeEvent);

    // The same two events on the channel that survives the office TLS filter. Published
    // SEPARATELY, never as one event to both users: the callee's carries `token`, which
    // is the X-Cyg-Call marker that stops them answering the CALLER's leg — both legs
    // fork to every browser, so handing the caller a token would pair the wrong one.
    this.realtime.publish('ringing', {
      userIds: [callerId],
      payload: callerEvent,
    });
    this.realtime.publish('ringing', {
      userIds: [calleeId],
      payload: calleeEvent,
    });

    // ── The history row goes LAST, and the order is the point ─────────────────────
    // SignalWire starts forking leg 1 to every registered browser the instant
    // `POST /Calls` is accepted, and the caller's browser then polls `pending-calls` a
    // handful of times over ~1.6s looking for the matching event. Every millisecond
    // between the create and the broadcast sits inside that race — and this write used to
    // sit exactly there, which is why the internal path lost its own calls while
    // click-to-call (no such write) never did.
    //
    // It still cannot be written before `createCall`: the sid only exists once the call
    // is created. And a failure here must not kill a call that is already ringing — a
    // history row is not worth that — so log every fact and let it proceed. The call
    // works; it is only unattributable afterwards.
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
  private folderWhere(
    folder: InternalCallFolder,
    userId: number,
  ): Prisma.InternalCallWhereInput {
    switch (folder) {
      case 'UNREAD':
        // An answered call is read by construction, so it must not be listed here either
        // — the folder, the DTO and the count all have to agree about one call.
        // `IMPLICITLY_READ_SQL` is the Prisma twin of `isImplicitlyReadInternalCall`.
        return {
          calleeId: userId,
          calleeReadAt: null,
          NOT: IMPLICITLY_READ_SQL,
        };
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
    //
    // The summary lines are deliberately NOT cached the way `recordedSids` is: that cache
    // exists because it is an account-wide SignalWire page, while this is one indexed DB
    // query over at most 30 sids.
    const [filled, recorded, summaryLines] = await Promise.all([
      this.backfillPending(page),
      this.recordedSids(),
      this.summaries.linesForCalls(page.map((r) => ({ sid: r.callSid }))),
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
          //
          // An ANSWERED incoming call is read too: you picked it up and spoke, which is
          // what reading it would have meant. See `isImplicitlyReadInternalCall`, and its
          // twin `isImplicitlyReadCall` on the company side.
          isRead:
            isImplicitlyReadInternalCall(
              outbound ? 'outbound' : 'inbound',
              this.outcomeOf(status, durationSec),
            ) || row.calleeReadAt != null,
          isCompleted: outbound || row.calleeCompletedAt != null,
          hasRecording: recorded.has(row.callSid),
          summaryLine: summaryLines.get(row.callSid) ?? null,
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
  ): Promise<{ unread: number; uncompleted: number; missedUnread: number }> {
    const [unread, uncompleted, unreadRows] = await Promise.all([
      this.prisma.internalCall.count({
        // Same predicate as the UNREAD folder, or the chip counts calls the list does
        // not show.
        where: {
          calleeId: userId,
          calleeReadAt: null,
          NOT: IMPLICITLY_READ_SQL,
        },
      }),
      this.prisma.internalCall.count({
        where: { calleeId: userId, calleeCompletedAt: null },
      }),
      // The unread calls themselves, so "missed" is decided by `outcomeOf` — the one
      // rule the history list uses — rather than a second copy of it as a Prisma where.
      // Callee-side unread rows only, so this is a handful of rows, not a history.
      this.prisma.internalCall.findMany({
        where: { calleeId: userId, calleeReadAt: null },
        select: {
          callSid: true,
          status: true,
          durationSec: true,
          startedAt: true,
          // So `backfillPending` can tell an ended call from one still ringing without
          // waiting out its age gate.
          endedAt: true,
        },
        orderBy: { id: 'desc' },
        take: InternalCallsService.MISSED_COUNT_SCAN,
      }),
    ]);

    // A call that just ended has no status until it is backfilled, and `outcomeOf` reads
    // that as in-progress — so without this a missed staff call would not count until
    // somebody happened to open their history. Limited to RECENT rows: this runs on the
    // dashboard's 60s poll, and a row SignalWire can no longer answer for would otherwise
    // be asked about every minute forever.
    const recentCutoff =
      Date.now() - InternalCallsService.MISSED_BACKFILL_WINDOW_MS;
    const filled = await this.backfillPending(
      unreadRows.filter((r) => r.startedAt.getTime() >= recentCutoff),
    );
    const missedUnread = unreadRows.filter((row) => {
      const patch = filled.get(row.callSid);
      return (
        this.outcomeOf(
          patch?.status ?? row.status,
          patch?.durationSec ?? row.durationSec,
        ) === 'missed'
      );
    }).length;

    return { unread, uncompleted, missedUnread };
  }

  private static readonly MISSED_COUNT_SCAN = 200;
  private static readonly MISSED_BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000;

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
    const row = await this.assertParticipant(userId, callSid);
    const now = new Date();
    const data =
      action === 'read'
        ? { calleeReadAt: now }
        : action === 'unread'
          ? { calleeReadAt: null }
          : action === 'complete'
            ? { calleeCompletedAt: now }
            : { calleeCompletedAt: null };
    const res = await this.prisma.internalCall.updateMany({
      where: { callSid, calleeId: userId },
      data,
    });

    // Nothing here is cached, so this is not an invalidation — it is how the user's OTHER
    // tabs and devices find out. Without it they keep the old unread/missed numbers until
    // their own 60s poll, which is the same "not real time" complaint one surface over.
    //
    // Scoped to the participants, and only when a row actually changed: the write is
    // `calleeId`-scoped, so a CALLER marking read is a deliberate no-op and has nothing
    // to announce.
    if (res.count > 0) {
      this.realtime.publish('internal-call', {
        userIds: [row.callerId, row.calleeId],
      });
    }
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
   * ── THIS IS NOW THE BACKSTOP, NOT THE MECHANISM ───────────────────────────────
   * `settleFromDial` is the primary path and settles a call the instant its `<Dial>`
   * ends. This still runs, and still matters, for the cases it cannot cover: a
   * conferenced call (whose dial-status is a join), a `completed` whose duration could
   * not be established, a push that lost the race with `startCall`'s own row write, and
   * anything at all that happened while the process was restarting.
   *
   * The webhook does NOT call this service directly — it emits on `PhoneEventsService`,
   * because this module depends on PhoneModule and the reverse edge would be a cycle
   * resolvable only with forwardRef. (The original note here said that made a push
   * impossible; it made a DIRECT CALL impossible, which is not the same thing.)
   *
   * Pulling costs one SignalWire request per not-yet-finalised row, which is now almost
   * always zero: a row is only pending between the call ending and the next time either
   * participant opens their history, and the push usually got there first.
   *
   * Never throws: a history list that renders without a duration is fine; one that 500s
   * is not.
   */
  private async backfillPending(
    rows: {
      callSid: string;
      status: string | null;
      startedAt: Date;
      endedAt?: Date | null;
    }[],
  ): Promise<Map<string, { status: string; durationSec: number }>> {
    const filled = new Map<string, { status: string; durationSec: number }>();

    // Rows whose outcome is not settled yet, and only once they are old enough that a live
    // call is not being mistaken for an unfinalised one.
    //
    // ⚠️ "Unsettled" means NULL *or* a LIVE status, and the second half is the fix. This
    // used to be `r.status === null` alone, so a row stamped while the call was still up
    // was frozen forever — nothing else in the codebase ever writes `InternalCall.status`.
    // The cutoff is only 35s, which is precisely when a call-waiting ring nobody answered
    // is still ringing, so such a row was stamped `ringing` and kept that answer for good.
    // 48 of 206 production rows were stuck this way.
    const unsettled = (status: string | null) =>
      status === null || LIVE.has(status);
    const cutoff =
      Date.now() - InternalCallsService.RING_TIMEOUT * 1000 - 5_000;
    // ⚠️ `endedAt` beats the age gate. The cutoff exists so a call that is still RINGING
    // is not mistaken for one that failed to finalise — but a row carrying an `endedAt`
    // is over, whatever its age, and gating it on `startedAt` made every read blind to
    // a short call for its first 35 seconds. That is a floor this feature cannot go
    // below otherwise, and it is measurable: a 20-second call is skipped by every read
    // until it turns 35 seconds old, while showing "In progress" throughout.
    //
    // ⚠️ `!= null`, loose on purpose. `endedAt` is OPTIONAL on the parameter because not
    // every caller selects it, and `undefined !== null` is TRUE — which would admit every
    // unsettled row including ones still ringing, inverting the guard this cutoff is.
    const pending = rows.filter(
      (r) =>
        unsettled(r.status) &&
        (r.endedAt != null || r.startedAt.getTime() < cutoff),
    );
    if (!pending.length) return filled;

    await Promise.all(
      pending.map(async (row) => {
        const patch = await this.settleOne(row);
        if (patch) filled.set(row.callSid, patch);
      }),
    );
    return filled;
  }

  /**
   * Work out how ONE finished call ended, from its legs, and write it.
   *
   * Extracted so `backfillPending` and `settleNow` share one copy of the child-leg rule
   * rather than two that drift. Returns the patch so the caller can project it onto a row
   * it has already read, or null when nothing could be concluded.
   */
  private async settleOne(row: {
    callSid: string;
    status: string | null;
    startedAt: Date;
  }): Promise<{ status: string; durationSec: number } | null> {
    try {
      // ⚠️ BOTH legs. The root is an `outbound-api` leg whose `<Dial>` ran to
      // completion whether or not anybody picked up — so it reports
      // `status: completed` with the RING time as its duration, and reading it
      // alone called every unanswered staff call "Answered". Verified live:
      //
      //   ROOT  d73f72ce  outbound-api  completed  dur=19
      //   child 102a14fe  outbound-dial no-answer  dur=18
      //   child eb256517  outbound-dial no-answer  dur=18
      //
      // This is the same trap `callOutcome` documents for the company timeline;
      // the internal path simply never got the child-leg treatment.
      const [call, children] = await Promise.all([
        this.signalwire.getCall(row.callSid),
        this.childLegsOf(row.callSid),
      ]);
      if (!call) return null;

      // Could not ask — say nothing rather than conclude. Leaving the status NULL is
      // what brings this row back on the next history read.
      if (children === null) return null;

      const deciding = pickConnectedChild(children);

      // ⚠️ NO child leg is not "fall back to the root" — that is the bug again in
      // miniature. An internal call is always a `<Dial><Sip>`, so a call somebody
      // ANSWERED must have produced a leg; no leg means nobody was ever reached.
      // Falling back to the root would read its `completed` and call it answered.
      //
      // The only reason to hesitate is timing: the rows may not have materialised
      // yet. So wait a little longer before concluding, and leave the status NULL
      // meanwhile — which is what makes the next history read try again.
      if (
        !deciding &&
        Date.now() - row.startedAt.getTime() <
          InternalCallsService.CHILD_LEG_GRACE_MS
      ) {
        return null;
      }

      // ⚠️ `'no-answer'`, and NOT `call.status`.
      //
      // `pickConnectedChild` returns null only for an empty list, so getting here
      // means SignalWire reported no child legs at all: nobody was ever reached.
      // This used to write the ROOT's status paired with a hardcoded zero, and the
      // root of a `<Dial>` reports `completed` whether or not anyone picked up — so
      // the row became ('completed', 0), which `outcomeOf` reads as MISSED through a
      // DURATION ACCIDENT rather than through a status, and which `unsettled()` then
      // considers settled, so nothing ever revisited it. An answered call could be
      // filed as missed, permanently. Naming an UNCONNECTED status instead reaches
      // the same outcome for the right reason, and keeps the root's `completed`
      // structurally unable to land in this column.
      const status = deciding?.status ?? 'no-answer';
      const durationSec = deciding?.durationSec ?? 0;

      // ⚠️ A LIVE status is not an outcome, and writing one is indistinguishable from
      // this whole bug. `pickConnectedChild` ranks `in-progress` FIRST (deliberately —
      // `durationSec` is 0 on a call that is still up), so winning the race against
      // SignalWire's own finalisation stamps the literal string `'in-progress'` into the
      // column. `LIVE` contains it, so `outcomeOf` then reports "In progress" from a row
      // that WAS written — and `unsettled()` sends it back round the same loop.
      // Leaving it NULL is strictly better: it says "not known yet", which is true.
      if (LIVE.has(status)) return null;

      await this.writeOutcome(
        row.callSid,
        status,
        durationSec,
        deciding ? 'child leg' : 'no child legs',
      );
      return { status, durationSec };
    } catch (err) {
      this.logger.warn(
        `could not backfill internal call ${row.callSid}: ${String(err)}`,
      );
      return null;
    }
  }

  /**
   * The child legs of one call, or an empty list.
   *
   * ⚠️ An `async` function, not a `.catch()` on the call, and that matters: a stub or a
   * transport that throws SYNCHRONOUSLY never produces a promise for `.catch` to attach
   * to, so the sibling request in the `Promise.all` above is left unhandled — which in
   * Node is a process exit, not a logged warning. An async wrapper turns every failure
   * mode into a rejection this catch can see.
   *
   * Re-filtered in memory because `listCalls` documents that an IGNORED `ParentCallSid`
   * returns everything rather than erroring. Probed live against the account and it is
   * honoured — two children came back per parent, not a full page — but a filter that
   * costs nothing outlives the probe that proved it.
   *
   * ⚠️ Returns NULL on failure and `[]` for "asked, and there are none". The caller reads
   * an empty list as "nobody was ever reached" and writes MISSED — so collapsing the two
   * would let one transient provider error permanently mark an answered call missed.
   */
  private async childLegsOf(callSid: string): Promise<SwCall[] | null> {
    try {
      const legs = await this.signalwire.listCalls({ parentCallSid: callSid });
      return legs.filter((leg) => leg.parentCallSid === callSid);
    } catch (err) {
      this.logger.warn(
        `could not list child legs for internal call ${callSid}: ${String(err)}`,
      );
      return null;
    }
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

  /**
   * How a transfer this user started is going. Participants only, same 404 as the rest.
   *
   * The requester is still a participant of the row after transferring — the row records
   * who placed and who received the call, not who is currently on it — so no special case
   * is needed to let them keep watching.
   */
  async transferStatus(userId: number, callSid: string) {
    await this.assertParticipant(userId, callSid);
    return this.callControl.transferStatus(callSid);
  }

  // ── Conference: bring a third colleague onto a staff call ──────────────────
  //
  // ⚠️ COLLEAGUE-ONLY, and structurally so: `conferenceContext` below builds an
  // `AddTarget` from a user id and there is no path here that accepts a number. A staff
  // call has no caller ID of its own, and borrowing some company's support number would
  // bill and brand a client's number for an internal matter -- as well as surfacing the
  // leg in that client's timeline, since `Calls?From={support}` is how it is built.
  //
  // Participants only, like every other `:sid` route here: `assertParticipant` throws
  // 404 rather than 403, and admins are excluded.

  /** Authorise, then describe the call — shared by the five operations below. */
  private async conferenceContext(userId: number, callSid: string) {
    const row = await this.assertParticipant(userId, callSid);
    const requester = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!requester) throw new NotFoundException('User not found');

    const workspace = await this.prisma.company.findFirst({
      where: { isInternal: true, internalOwnerId: userId, deletedAt: null },
      select: { id: true },
    });

    return {
      rootSid: callSid,
      kind: 'internal' as const,
      requesterIsCaller: row.callerId === userId,
      requester,
      companyId: workspace?.id ?? 0,
      companyName: requester.name,
      participants: [row.callerId, row.calleeId],
    };
  }

  async conferenceAdd(userId: number, callSid: string, targetUserId: number) {
    const { participants, ...ctx } = await this.conferenceContext(
      userId,
      callSid,
    );
    // Neither person already on the call may be added to it again.
    await this.callControl.resolveTarget(targetUserId, userId, participants);
    return this.conference.addCall(ctx, { userId: targetUserId });
  }

  async conferenceHold(
    userId: number,
    callSid: string,
    partyId: string,
    held: boolean,
  ) {
    const { participants: _p, ...ctx } = await this.conferenceContext(
      userId,
      callSid,
    );
    return this.conference.setPartyHold(ctx, partyId, held);
  }

  async conferenceSwap(userId: number, callSid: string) {
    const { participants: _p, ...ctx } = await this.conferenceContext(
      userId,
      callSid,
    );
    return this.conference.swap(ctx);
  }

  async conferenceMerge(userId: number, callSid: string) {
    const { participants: _p, ...ctx } = await this.conferenceContext(
      userId,
      callSid,
    );
    return this.conference.merge(ctx);
  }

  async conferenceDrop(userId: number, callSid: string, partyId: string) {
    const { participants: _p, ...ctx } = await this.conferenceContext(
      userId,
      callSid,
    );
    return this.conference.dropParty(ctx, partyId);
  }

  async conferenceStatus(userId: number, callSid: string) {
    await this.assertParticipant(userId, callSid);
    return this.conference.conferenceStatus(callSid);
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
    // ⚠️ A leg still in a LIVE status has not decided anything yet, and this line is what
    // was missing: without it a row stamped `ringing` or `in-progress` falls straight
    // through to the duration test below and reports ANSWERED for a call nobody picked up.
    // 48 of 206 production rows were in exactly that state. The company twin
    // `callOutcome` has opened with this check since it was written.
    if (LIVE.has(status)) return 'in-progress';
    if (UNCONNECTED.has(status)) return 'missed';
    // Reached only for a leg that connected. The duration test is now a backstop rather
    // than the load-bearing check it used to be: `status` is the DECIDING leg's (see
    // `backfillPending`), so a ring-out arrives here as `no-answer` and is caught above.
    // It used to be the root's, which is `completed` with the ring time as its duration —
    // so this line answered "answered" for every unanswered call in the system.
    return (durationSec ?? 0) > 0 ? 'answered' : 'missed';
  }
}
