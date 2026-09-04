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
import { CallSummaryService } from '../phone/call-summary.service.js';
import type { CallSummaryView } from '../phone/call-summary.util.js';
import { dialSip } from '../phone/laml.util.js';
import {
  recordMode,
  sipDialTarget,
  webhookUrls,
} from '../phone/phone.config.js';
import { signRecordingToken } from '../phone/recording-token.util.js';

/** One row of a user's call history, from their own point of view. */
export interface InternalCallView {
  sid: string;
  /** Relative to the VIEWER, not to the row. The same call is outbound for one
   *  participant and inbound for the other. */
  direction: 'inbound' | 'outbound';
  peer: { id: number; name: string };
  at: string;
  durationSec: number | null;
  status: string | null;
  outcome: 'answered' | 'missed' | 'in-progress';
}

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
   * This user's call history, newest first.
   *
   * Costs no SignalWire requests for calls that have already been finalised, which is
   * almost all of them -- see backfillPending for the exception and why it is pulled.
   */
  async list(userId: number, limit = 50): Promise<InternalCallView[]> {
    const rows = await this.prisma.internalCall.findMany({
      where: { OR: [{ callerId: userId }, { calleeId: userId }] },
      orderBy: { startedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        caller: { select: { id: true, name: true } },
        callee: { select: { id: true, name: true } },
      },
    });

    const filled = await this.backfillPending(rows);

    return rows.map((row) => {
      const outbound = row.callerId === userId;
      const peer = outbound ? row.callee : row.caller;
      const patch = filled.get(row.callSid);
      const status = patch?.status ?? row.status;
      const durationSec = patch?.durationSec ?? row.durationSec;
      return {
        sid: row.callSid,
        direction: outbound ? 'outbound' : 'inbound',
        peer: { id: peer.id, name: peer.name },
        at: row.startedAt.toISOString(),
        durationSec,
        status,
        outcome: this.outcomeOf(status, durationSec),
      };
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
