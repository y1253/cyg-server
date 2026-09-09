import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SignalWireService } from './signalwire.service';
import { PhoneEventsService } from './phone-events.service';
import {
  classifyLegs,
  transferStateOf,
  type CallKind,
  type Legs,
  type TransferRecord,
  type TransferState,
} from './call-legs.util';
import { dialSip } from './laml.util';
import { recordMode, sipDialTarget, webhookUrls } from './phone.config';

export interface TransferContext {
  /** The sid the CLIENT holds — `info.callSid`. Every authorization check runs on it. */
  rootSid: string;
  kind: CallKind;
  /** Internal calls only; see `LegContext.requesterIsCaller`. */
  requesterIsCaller?: boolean;
  /** Who is asking. Used for `transferFrom`, never read from the request body. */
  requester: { id: number; name: string };
  /** Where the transferee lands when they click through from the overlay. */
  companyId: number;
  companyName: string;
}

/**
 * Moving a live call somewhere else.
 *
 * ── WHAT THIS OWNS, AND WHAT IT DELIBERATELY DOES NOT ─────────────────────────
 * It owns the provider calls and the ORDER they happen in. It owns NO authorization,
 * because the two entry points answer different questions with different primitives:
 * a company call is guarded by `assertMayUseCompanyPhone` + `assertCallBelongsTo`, an
 * internal call by `assertParticipant` (404, never 403, and admins are excluded). Those
 * cannot be unified without weakening one of them, so each caller runs its own and hands
 * this service an already-authorised `TransferContext`.
 *
 * ⚠️ **Every check upstream runs against `rootSid`, and the leg sids below are derived
 * here — never accepted from a client.** A target or child leg would fail
 * `assertCallBelongsTo` anyway (it touches no support number), so accepting one from the
 * request would be an unauthenticated "redirect any call on the account" primitive.
 */
@Injectable()
export class CallControlService {
  private readonly logger = new Logger(CallControlService.name);

  /** Seconds the transferred-to colleague's phone rings before voicemail takes over. */
  private static readonly RING_TIMEOUT = 30;

  /** Long enough to outlive the ring plus the client's own safety timeout, no longer. */
  private static readonly TRANSFER_TTL_MS = 120_000;

  /**
   * What each in-flight transfer did, keyed by the ROOT sid the client already holds.
   *
   * ── WHY REMEMBER ANYTHING, IN A MODULE THAT PERSISTS NOTHING ──────────────────
   * The status route has to answer "has my colleague picked up?" and the only sid a
   * client may present is the root — every guard in this module runs on the root, and
   * `assertParticipant` cannot even look an internal call up by anything else. Recovering
   * the peer leg from the root each poll would cost an extra `legsFor` round-trip, and it
   * still would not recover `previousAgentSid`, without which a not-yet-dead agent leg
   * reads as "they picked up". So the one thing that cannot be re-derived is kept.
   *
   * In memory, like `PhoneEventsService.pending` — a restart mid-transfer costs the card,
   * not the call, and the client's safety timeout clears it.
   */
  private readonly transfers = new Map<string, TransferRecord>();

  constructor(
    private prisma: PrismaService,
    private signalwire: SignalWireService,
    private events: PhoneEventsService,
  ) {}

  /**
   * The transfer target, as a directory user.
   *
   * Kept here rather than in each controller so the two entry points cannot drift on the
   * wording or on which users count as transferable.
   */
  async resolveTarget(
    targetUserId: number,
    requesterId: number,
    forbidden: number[] = [],
  ): Promise<{ id: number; name: string }> {
    if (targetUserId === requesterId) {
      throw new BadRequestException('You cannot transfer a call to yourself');
    }
    if (forbidden.includes(targetUserId)) {
      throw new BadRequestException('That person is already on this call');
    }
    const user = await this.prisma.user.findFirst({
      where: { id: targetUserId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!user)
      throw new NotFoundException('That person is no longer available');
    return user;
  }

  /**
   * Which leg is the agent on, and which is the other party?
   *
   * Two requests: the root, then its children. If probe #3 shows `ParentCallSid` is
   * ignored, the second returns the whole window instead — so the result is re-filtered
   * in memory here regardless, and the query is treated as an optimisation rather than a
   * guarantee.
   */
  async legsFor(ctx: TransferContext): Promise<Legs> {
    const root = await this.signalwire.getCall(ctx.rootSid);
    if (!root) throw new NotFoundException('Call not found');

    const rows = await this.signalwire.listCalls({
      parentCallSid: ctx.rootSid,
    });
    const children = rows.filter((c) => c.parentCallSid === ctx.rootSid);

    return classifyLegs(root, children, ctx.kind, {
      requesterIsCaller: ctx.requesterIsCaller,
    });
  }

  /**
   * Hand the call straight over and drop out — a cold transfer.
   *
   * No conference is involved, which is why this works independently of every open
   * question about `<Conference>` support.
   *
   * ⚠️ **ORDER IS LOAD-BEARING, and the wrong way round loses the caller.** Redirecting
   * a leg tears down the `<Dial>` bridge, so the OTHER leg falls through its document.
   * Hanging up the agent first would tear the bridge down while the customer is still
   * executing the original `<Dial>`, dropping them into `voice/dial-status` — i.e. into
   * voicemail — before they were ever offered to anybody. So the peer is redirected
   * FIRST, and only then is the agent's leg cleared.
   *
   * The agent's leg usually dies on its own when the bridge ends; it is hung up
   * explicitly anyway so the browser gets a clean BYE instead of lingering until the
   * media times out. That call is best-effort: the transfer has already happened by then
   * and failing it would report a failure for a call that did move.
   */
  async blindTransfer(
    ctx: TransferContext,
    target: { id: number; name: string },
  ): Promise<{ transferredSid: string; target: { id: number; name: string } }> {
    const sipTarget = sipDialTarget(process.env);
    if (!sipTarget) {
      throw new BadRequestException(
        'No SIP endpoint is configured, so a call cannot be transferred',
      );
    }

    const legs = await this.legsFor(ctx);
    if (!legs.peerSid) {
      // Still ringing: there is no second party to hand over yet. Guessing the root
      // here would redirect whoever happens to be on it, which on an outbound call is
      // the agent themselves.
      throw new BadRequestException(
        'This call has not connected yet, so there is nobody to transfer',
      );
    }

    /**
     * No `X-Cyg-Call` marker on this `<Sip>`, deliberately.
     *
     * The client pairs an INVITE with an event only when
     * `(pending.token ?? null) === markerOf(invitation)`. CLAUDE.md records that header
     * delivery through a `<Sip>` URI parameter is UNVERIFIED against the live account —
     * so sending a token on the event while the header silently fails to arrive would
     * compare `'tok' !== null` and NEVER pair, breaking transfer outright. With neither
     * side set it is `null === null` and pairing works.
     *
     * Nothing is lost by omitting it: `pending` is per-user and only the target receives
     * an event, so no other browser has anything to pair this INVITE with.
     */
    const laml = dialSip([{ uri: sipTarget }], {
      timeout: CallControlService.RING_TIMEOUT,
      // Reuses the existing unanswered-call path: `voice/dial-status` hangs up on
      // `completed` and offers voicemail on anything else, so a colleague who does not
      // pick up drops the caller into the company's own voicemail rather than silence.
      action: webhookUrls(process.env).dialStatusUrl,
      // Redirecting the leg replaces its document, and with it every attribute the
      // ORIGINAL `<Dial>` carried — including `record`. Without this the conversation
      // stops being recorded at the moment of transfer and gets no AI summary, silently:
      // the call still works, and the missing half only shows up afterwards.
      record: recordMode(process.env),
    });

    await this.signalwire.updateCall(legs.peerSid, { laml });

    // BEFORE the broadcast, and by user id rather than call sid — on an inbound transfer
    // both entries name the SAME sid, so a sweep here would delete the ring we are about
    // to deliver. `resolveTarget` has already refused a transfer to yourself, so these
    // two can never be the same user.
    //
    // Without this the transferrer's ORIGINAL event survives in `pending` for its full
    // 60s TTL, their browser is handed it back when the transfer `<Dial><Sip>` fork
    // arrives (every browser shares one SIP credential), and they are rung by the call
    // they just gave away.
    this.events.clearPendingFor(ctx.requester.id);

    this.transfers.set(ctx.rootSid, {
      peerSid: legs.peerSid,
      previousAgentSid: legs.agentSid,
      target,
      at: Date.now(),
    });
    this.sweepTransfers();

    this.events.broadcastIncomingCall([target.id], {
      type: 'incoming-call',
      direction: 'inbound',
      companyId: ctx.companyId,
      companyName: ctx.companyName,
      // The party they will actually be speaking to, not the person handing it over —
      // `transferFrom` carries that separately so the card can show both.
      from: await this.counterpartyLabel(legs, ctx),
      callSid: legs.peerSid,
      at: Date.now(),
      transferFrom: { id: ctx.requester.id, name: ctx.requester.name },
      // Written out rather than passing `ctx.kind` through: this is the CallEvent's
      // 'company' | 'internal' (which endpoint the client posts to), not `CallKind`'s
      // 'inbound' | 'outbound' | 'internal' (which leg the agent is on).
      kind: ctx.kind === 'internal' ? 'internal' : 'company',
    });

    if (legs.agentSid && legs.agentSid !== legs.peerSid) {
      try {
        await this.signalwire.updateCall(legs.agentSid, {
          status: 'completed',
        });
      } catch {
        // The transfer already happened. Surfacing this would report a failure for a
        // call that did move, and the leg dies with the bridge anyway.
        this.logger.warn(
          `blindTransfer ${ctx.rootSid}: agent leg ${legs.agentSid} did not hang up cleanly`,
        );
      }
    }

    this.logger.log(
      `blindTransfer ${ctx.rootSid} kind=${ctx.kind} peer=${legs.peerSid} ` +
        `by=${ctx.requester.id} to=${target.id}`,
    );
    return { transferredSid: legs.peerSid, target };
  }

  /**
   * "Has my colleague picked up yet?", for the card the transferring agent is watching.
   *
   * Keyed on the ROOT sid the caller has already been authorised for — the entry points
   * hand this an `rootSid` their own guard has cleared, exactly as `blindTransfer` does.
   * Nothing here accepts a leg sid.
   *
   * Never throws. A poll that 500s would strand the card behind its safety timeout, and
   * the transfer itself has already happened either way — an unknown answer is reported
   * as `'ended'`, which is the state that closes the card cleanly.
   */
  async transferStatus(
    rootSid: string,
  ): Promise<{ state: TransferState; targetName: string | null }> {
    const record = this.transfers.get(rootSid);
    if (
      !record ||
      Date.now() - record.at > CallControlService.TRANSFER_TTL_MS
    ) {
      return { state: 'ended', targetName: null };
    }

    try {
      const peer = await this.signalwire.getCall(record.peerSid);
      const rows = peer
        ? await this.signalwire.listCalls({ parentCallSid: record.peerSid })
        : [];
      const children = rows.filter((c) => c.parentCallSid === record.peerSid);
      const state = transferStateOf(peer, children, record);
      if (state !== 'ringing') this.transfers.delete(rootSid);
      return { state, targetName: record.target.name };
    } catch (err) {
      this.logger.warn(
        `transferStatus ${rootSid}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { state: 'ended', targetName: record.target.name };
    }
  }

  /** Drop records the client will never ask about again. */
  private sweepTransfers(): void {
    const cutoff = Date.now() - CallControlService.TRANSFER_TTL_MS;
    for (const [sid, record] of this.transfers) {
      if (record.at < cutoff) this.transfers.delete(sid);
    }
  }

  /** What to show the transferee as the other party on the call. */
  private async counterpartyLabel(
    legs: Legs,
    ctx: TransferContext,
  ): Promise<string> {
    if (ctx.kind === 'internal') {
      // An internal call has no E.164 counterparty at all; the useful label is the
      // colleague being handed over, which the caller already knows.
      return ctx.companyName;
    }
    const peer = legs.peerSid
      ? await this.signalwire.getCall(legs.peerSid)
      : null;
    // On an inbound call the peer leg's `from` is the customer; on an outbound one the
    // peer leg IS the customer and its `to` is their number.
    return (ctx.kind === 'inbound' ? peer?.from : peer?.to) ?? '';
  }
}
