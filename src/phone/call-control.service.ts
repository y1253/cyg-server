import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SignalWireService } from './signalwire.service';
import { PhoneEventsService } from './phone-events.service';
import { classifyLegs, type CallKind, type Legs } from './call-legs.util';
import { dialSip } from './laml.util';
import { sipDialTarget, webhookUrls } from './phone.config';

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
  ): Promise<{ transferredSid: string }> {
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
    });

    await this.signalwire.updateCall(legs.peerSid, { laml });

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
    return { transferredSid: legs.peerSid };
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
