import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SignalWireService } from './signalwire.service';
import { PhoneEventsService } from './phone-events.service';
import { CallControlService, type CallContext } from './call-control.service';
import {
  conferenceRoomFor,
  conferenceStateOf,
  rootSidFromRoom,
  MAX_ADDED_PARTIES,
  type ConferenceParty,
  type ConferenceRecord,
  type ConferenceView,
} from './call-legs.util';
import { conferenceDoc } from './conference-laml.util';
import { isE164, type SwParticipant } from './signalwire-parse';
import { sipDialTarget, webhookUrls } from './phone.config';

/** Who to bring into the call. Resolved HERE — the client never names a number to dial. */
export type AddTarget =
  | { userId: number }
  | { phone: string }
  | { contactId: number };

/**
 * Bringing more people into a live call: add, hold, swap, merge, drop.
 *
 * ── WHY THIS IS NOT PART OF CallControlService ────────────────────────────────
 * That class's docblock makes a point of blind transfer working "independently of every
 * open question about `<Conference>` support", and that independence is a shipped asset:
 * if conferences misbehave in production, transfer must keep working. So this is a
 * separate service that INJECTS it for `legsFor` and `resolveTarget` rather than
 * extending it.
 *
 * Like `CallControlService`, it owns NO authorization. The two entry points ask
 * different questions with different primitives — `assertMayUseCompanyPhone` +
 * `assertCallBelongsTo` for a company call, `assertParticipant` (404, never 403) for an
 * internal one — and each caller runs its own before handing over an authorised context.
 *
 * ⚠️ Every check upstream runs on `rootSid`. Leg sids are derived here and never accepted
 * from a client: a child leg touches no support number, so it would sail past
 * `assertCallBelongsTo` by never being checked at all.
 */
@Injectable()
export class ConferenceService {
  private readonly logger = new Logger(ConferenceService.name);

  /** Seconds a newly added party's phone rings before giving up. */
  private static readonly RING_TIMEOUT = 30;

  /** A conference can legitimately run for hours; this only bounds a leaked record. */
  private static readonly TTL_MS = 4 * 60 * 60 * 1000;

  /**
   * How long to wait for every leg to actually BE in the room.
   *
   * ⚠️ Sized against the `voice/dial-status` round-trip, not against API latency. The
   * root is not even told to move until its `<Dial>` ends and SignalWire calls us back,
   * which the live logs put at 1-2 seconds. The previous budget was 3 x 200ms and could
   * never have been enough.
   */
  private static readonly ROOM_LOOKUP_ATTEMPTS = 20;
  private static readonly ROOM_LOOKUP_DELAY_MS = 400;

  /** Never delete a record younger than this; formation must be allowed to finish. */
  private static readonly FORMING_GRACE_MS = 15_000;

  /**
   * Live conferences, keyed by the sid the CLIENT holds — which may differ from
   * `record.rootSid` when a forked click-to-call left the client holding a dead twin.
   *
   * In memory, like `CallControlService.transfers` and `PhoneEventsService.pending`. A
   * restart mid-call costs the add/hold/swap CONTROLS, not the call: the legs are bridged
   * by SignalWire and keep talking, the client's status poll 404s and clears the card.
   */
  private readonly conferences = new Map<string, ConferenceRecord>();

  constructor(
    private prisma: PrismaService,
    private signalwire: SignalWireService,
    private events: PhoneEventsService,
    private callControl: CallControlService,
  ) {}

  // ── The dial-status join ───────────────────────────────────────────────────

  /**
   * Which room does this leg belong to? PURE — it mutates nothing.
   *
   * ── WHY THIS IS NOT A ONE-SHOT CLAIM ──────────────────────────────────────
   * It used to be `awaitingRootJoin`, which set a `rootJoined` flag so that the webhook
   * and an explicit `updateCall` could not both move the root. That design dropped live
   * calls, and could not have worked:
   *
   * **A `<Dial action>` webhook has no no-op response.** Whatever LaML it returns
   * REPLACES the leg's document. `<Hangup/>` kills the leg; an empty `<Response/>`
   * exhausts it and kills it just as dead. There is no "leave this call alone" answer.
   * So the webhook is unavoidably a mover — and therefore has to be the ONLY one.
   *
   * Being idempotent rather than one-shot is what makes a webhook RETRY safe: during a
   * retry the leg is not in the room (it is waiting for our answer), so handing it the
   * same join document again cannot pull anybody out.
   *
   * After the room forms this can no longer fire for these legs at all, because no
   * conference document carries `action` — so there is no long tail to worry about.
   */
  joinTargetFor(callSid: string): ConferenceRecord | null {
    for (const record of this.conferences.values()) {
      if (record.state === 'ended') continue;
      if (
        record.rootSid === callSid ||
        record.agentSid === callSid ||
        record.parties.some((p) => p.legSid === callSid)
      ) {
        return record;
      }
    }
    return null;
  }

  /** The conference one leg belongs to, for the hold-audio webhook. */
  recordForLeg(callSid: string): ConferenceRecord | null {
    return this.joinTargetFor(callSid);
  }

  /** The record a conference status callback is talking about, by room name. */
  recordForRoom(room: string): ConferenceRecord | null {
    // Cheap "is this one of ours at all" check before scanning.
    if (!rootSidFromRoom(room)) return null;
    // By ROOM, not by key: the map is keyed by the client's sid, while the room is named
    // after the live root, and on a forked click-to-call those are different sids.
    for (const record of this.conferences.values()) {
      if (record.room === room && record.state !== 'ended') return record;
    }
    return null;
  }

  /**
   * Bookkeeping from `voice/conference-status`. NEVER throws.
   *
   * This is the only thing in the system that can say WHICH LEG JOINED WHICH ROOM — the
   * fact that was missing from two rounds of debugging this feature. Treat its logging as
   * part of the feature, not decoration.
   */
  noteConferenceEvent(body: Record<string, string>): void {
    try {
      const room = body.FriendlyName ?? '';
      const event = body.StatusCallbackEvent ?? '';
      const conferenceSid = body.ConferenceSid ?? '';
      const callSid = body.CallSid ?? '';
      const record = this.recordForRoom(room);
      if (!record) return;

      if (event === 'conference-end') {
        // ⚠️ Only for the room we are actually in. An end event for a STALE sid while we
        // are still forming must not delete the record — the root would then have nothing
        // to join and dial-status would hang the call up.
        if (record.conferenceSid && conferenceSid !== record.conferenceSid) {
          this.logger.warn(
            `${room} ignoring conference-end for foreign sid ${conferenceSid} ` +
              `(ours is ${record.conferenceSid})`,
          );
          return;
        }
        record.state = 'ended';
        this.conferences.delete(record.clientSid);
        this.logger.log(`${room} ended (${conferenceSid})`);
        return;
      }

      if (conferenceSid) {
        if (!record.conferenceSid) {
          record.conferenceSid = conferenceSid;
        } else if (record.conferenceSid !== conferenceSid) {
          // The split-brain alarm. See `pickRoom`.
          this.logger.error(
            `${room} SPLIT ROOM: leg ${callSid} joined ${conferenceSid} but ours is ` +
              `${record.conferenceSid}`,
          );
        }
      }

      if (event === 'participant-join' && callSid) record.joined.add(callSid);
      if (event === 'participant-leave' && callSid) record.joined.delete(callSid);

      if (
        record.state === 'forming' &&
        record.joined.has(record.agentSid) &&
        record.joined.has(record.rootSid)
      ) {
        record.state = 'live';
        this.logger.log(`${room} forming -> live (${record.conferenceSid})`);
      }
    } catch (err) {
      this.logger.warn(`noteConferenceEvent failed: ${String(err)}`);
    }
  }

  // ── Add ────────────────────────────────────────────────────────────────────

  /**
   * Bring one more person into a live call.
   *
   * ⚠️ **ORDER: the CHILD leg is redirected FIRST, then the ROOT.**
   *
   * A `<Dial>`-created child owns no LaML document of its own, so while its parent's
   * `<Dial>` is being replaced it has nothing to fall through to and dies. A root always
   * owns a document. Giving the child its own `<Dial><Conference>` first means nothing
   * the root subsequently does can orphan it.
   *
   * ⚠️ This is NOT `blindTransfer`'s rule, which redirects the PEER first, and on an
   * inbound call it is the exact opposite leg. The two coincide only on outbound calls —
   * which is precisely how a root-first version would pass a test and drop inbound
   * customers in production. `conference.service.spec.ts` asserts the order per `CallKind`.
   */
  async addCall(ctx: CallContext, target: AddTarget): Promise<ConferenceView> {
    const existing = this.conferences.get(ctx.rootSid);

    if (existing && existing.parties.length >= MAX_ADDED_PARTIES + 1) {
      throw new BadRequestException(
        `You can add up to ${MAX_ADDED_PARTIES} more people to a call`,
      );
    }

    const resolved = await this.resolveAddTarget(ctx, target);
    const record = existing ?? (await this.beginConference(ctx));

    /**
     * ⚠️ Wait for the PARTICIPANTS, not merely for the conference row to exist — the very
     * next thing we do is hold somebody, and `updateParticipant` against a leg that has
     * not joined is a 404. On the first add this also waits out the dial-status
     * round-trip that moves the root.
     *
     * Only the two ORIGINAL legs are required. A party added earlier may still be
     * ringing, and waiting for them would block this add behind somebody else's phone —
     * possibly until it goes to voicemail. They are simply not held; see `holdAll`.
     */
    const peerLeg = record.parties.find((p) => p.kind === 'peer')?.legSid;
    const { sid: conferenceSid, participants } = await this.awaitRoom(
      record,
      peerLeg ? [record.agentSid, peerLeg] : [record.agentSid],
    );
    record.conferenceSid = conferenceSid;
    if (record.state === 'forming') {
      record.state = 'live';
      this.logger.log(`${record.room} forming -> live (${conferenceSid})`);
    }

    // Dialling somebody new parks whoever you were talking to, exactly as a phone does.
    // BEFORE the new leg is created: if a hold fails after a stranger is already on the
    // line, that stranger is listening to a client who was never put on hold.
    await this.holdAll(conferenceSid, record, true, participants);

    const call = await this.signalwire.createCall({
      to: resolved.to,
      from: resolved.from,
      laml: conferenceDoc({
        room: record.room,
        role: 'party',
        // A newly created leg is never the call's root, so it never carries `record`.
        isRoot: false,
        holdUrl: webhookUrls(process.env).conferenceWaitUrl,
      }),
      statusCallback: webhookUrls(process.env).statusCallback,
      timeoutSec: ConferenceService.RING_TIMEOUT,
    });

    record.parties.push({
      id: `p${record.nextPartyId}`,
      legSid: call.sid,
      label: resolved.label,
      kind: resolved.kind,
    });
    record.nextPartyId += 1;

    this.logger.log(
      `addCall root=${ctx.rootSid} live=${record.rootSid} +${resolved.label} (${record.parties.length} parties)`,
    );

    if (resolved.notifyUserId !== undefined) {
      this.events.broadcastIncomingCall(
        [resolved.notifyUserId],
        {
          type: 'incoming-call',
          direction: 'inbound',
          companyId: ctx.companyId,
          companyName: ctx.companyName,
          from: ctx.companyName,
          callSid: call.sid,
          at: Date.now(),
          kind: ctx.kind === 'internal' ? 'internal' : 'company',
          transferFrom: ctx.requester,
        },
        // ⚠️ NOT published to `ringingByCompany`. That map drives the in-tab Answer
        // banner for ANY idle viewer of the company — so publishing here would offer an
        // unrelated admin a button that drops them into a live client conference.
        { publishToCompany: false },
      );
    }

    return this.viewOf(record, conferenceSid);
  }

  // ── Hold, swap, merge, drop ────────────────────────────────────────────────

  async setPartyHold(
    ctx: CallContext,
    partyId: string,
    held: boolean,
  ): Promise<ConferenceView> {
    const record = this.requireRecord(ctx.rootSid);
    const conferenceSid = await this.requireRoomSid(record);
    const party = this.requireParty(record, partyId);

    await this.setHold(conferenceSid, party, held);
    return this.viewOf(record, conferenceSid);
  }

  /**
   * Talk to the other one.
   *
   * ⚠️ HOLD FIRST, THEN UNHOLD. The reverse order puts both parties in one conversation
   * for a moment — which is the exact leak this feature exists to prevent. If the hold
   * throws, `updateParticipant` propagates it and the unhold never runs.
   *
   * Only legal with exactly two parties present: with one there is nobody to swap to,
   * and with three "swap" has no unambiguous meaning. The client hides the control in
   * both cases; this is the enforcement.
   */
  async swap(ctx: CallContext): Promise<ConferenceView> {
    const record = this.requireRecord(ctx.rootSid);
    const conferenceSid = await this.requireRoomSid(record);
    const participants = await this.signalwire.listParticipants(conferenceSid);
    const heldByLeg = new Map(participants.map((p) => [p.callSid, p.hold]));

    const present = record.parties.filter((p) => heldByLeg.has(p.legSid));
    if (present.length !== 2) {
      throw new BadRequestException(
        'Swapping needs exactly two other people on the call',
      );
    }

    const [a, b] = present;
    const toHold = heldByLeg.get(a.legSid) === false ? a : b;
    const toResume = toHold === a ? b : a;

    await this.setHold(conferenceSid, toHold, true);
    await this.setHold(conferenceSid, toResume, false);

    return this.viewOf(record, conferenceSid);
  }

  /** Everybody hears everybody. */
  async merge(ctx: CallContext): Promise<ConferenceView> {
    const record = this.requireRecord(ctx.rootSid);
    const conferenceSid = await this.requireRoomSid(record);
    await this.holdAll(conferenceSid, record, false);
    return this.viewOf(record, conferenceSid);
  }

  /**
   * Remove one person from the call.
   *
   * ⚠️ If that leaves exactly one party and they are held, they are un-held. Otherwise
   * the agent is left talking to somebody who cannot hear them, with the only clue being
   * a badge on a card they may not be looking at.
   */
  async dropParty(ctx: CallContext, partyId: string): Promise<ConferenceView> {
    const record = this.requireRecord(ctx.rootSid);
    const conferenceSid = await this.requireRoomSid(record);
    const party = this.requireParty(record, partyId);

    const removed = await this.signalwire.removeParticipant(
      conferenceSid,
      party.legSid,
    );
    if (!removed) {
      // No conference document has an `action` or a following verb, so hanging the leg
      // up and removing it from the room are the same outcome for the person on it.
      await this.signalwire
        .updateCall(party.legSid, { status: 'completed' })
        .catch((err) =>
          this.logger.warn(`dropParty fallback failed: ${String(err)}`),
        );
    }

    record.parties = record.parties.filter((p) => p.id !== partyId);

    if (record.parties.length === 1) {
      const last = record.parties[0];
      const participants = await this.signalwire.listParticipants(conferenceSid);
      if (participants.find((p) => p.callSid === last.legSid)?.hold) {
        await this.setHold(conferenceSid, last, false);
      }
    }

    return this.viewOf(record, conferenceSid);
  }

  /**
   * What the client polls.
   *
   * ⚠️ NEVER throws, the same rule `transferStatus` follows. A poll that raises turns a
   * transient provider blip into a call card that reports an error over a call which is
   * in fact perfectly fine. An inactive answer clears the card and leaves the call alone.
   */
  async conferenceStatus(rootSid: string): Promise<ConferenceView> {
    const record = this.conferences.get(rootSid);
    if (!record) return this.inactive();

    /**
     * ⚠️ While the room is FORMING, answer from the record alone — no provider call, and
     * above all NO delete.
     *
     * The client polls this every few seconds. The root is moved into the room by
     * `voice/dial-status`, which takes 1-2 seconds, and during that window there is
     * legitimately no assembled room to find. The previous version deleted the record on
     * exactly that condition — and once the record is gone, dial-status has nothing to
     * join and hangs the call up. That is the same crash this fix exists to remove,
     * reached by a different door.
     */
    if (record.state === 'forming') {
      return {
        active: true,
        parties: record.parties.map((p) => ({
          id: p.id,
          label: p.label,
          state: 'ringing' as const,
        })),
        merged: true,
        canAdd: false,
        canSwap: false,
      };
    }

    try {
      const conferenceSid = await this.pickRoom(record.room);
      if (!conferenceSid) {
        this.forget(record, 'room gone');
        return this.inactive();
      }
      const view = await this.viewOf(record, conferenceSid);
      if (!view.active) this.forget(record, 'agent left the room');
      return view;
    } catch (err) {
      // A blip must not blank a live call's controls; the next poll re-asks.
      this.logger.warn(`${record.room} status check failed: ${String(err)}`);
      return this.inactive();
    }
  }

  /**
   * Drop a record, but never one that is younger than the formation grace.
   *
   * Belt to the `forming` short-circuit's braces: any future deletion path inherits the
   * rule that a just-created conference is left alone, because deleting one strands the
   * root's dial-status.
   */
  private forget(record: ConferenceRecord, why: string): void {
    if (Date.now() - record.at < ConferenceService.FORMING_GRACE_MS) {
      this.logger.debug(`${record.room} keeping record (${why}, still in grace)`);
      return;
    }
    record.state = 'ended';
    this.conferences.delete(record.clientSid);
    this.logger.log(`${record.room} record dropped (${why})`);
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /** Move both existing legs into the room, and remember it. */
  private async beginConference(ctx: CallContext): Promise<ConferenceRecord> {
    const legs = await this.callControl.legsFor(ctx);
    if (!legs.agentSid || !legs.peerSid) {
      throw new BadRequestException(
        'This call has not connected yet, so there is nobody to add to',
      );
    }

    // The LIVE root, not the client's sid: the room must be the one dial-status for the
    // live root joins, and on a forked click-to-call the two differ.
    const room = conferenceRoomFor(legs.rootSid);
    // ⚠️ Against the LIVE root. Comparing with `ctx.rootSid` — which may be a dead twin —
    // makes this false on an outbound call, turns the live ROOT into `childSid`, and
    // redirects it: a second mover for the root, the exact bug that dropped calls before.
    const agentIsRoot = legs.agentSid === legs.rootSid;
    const childSid = agentIsRoot ? legs.peerSid : legs.agentSid;
    const holdUrl = webhookUrls(process.env).conferenceWaitUrl;

    const peerParty: ConferenceParty = {
      id: 'peer',
      legSid: legs.peerSid,
      label: ctx.companyName,
      kind: 'peer',
    };

    const record: ConferenceRecord = {
      room,
      kind: ctx.kind,
      agentSid: legs.agentSid,
      clientSid: ctx.rootSid,
      rootSid: legs.rootSid,
      childSid,
      state: 'forming',
      conferenceSid: null,
      joined: new Set<string>(),
      parties: [peerParty],
      companyId: ctx.companyId,
      nextPartyId: 2,
      at: Date.now(),
    };

    // BEFORE any provider call. Redirecting the child ends the root's <Dial>, and the
    // dial-status callback that follows can only find its room through this map.
    this.conferences.set(ctx.rootSid, record);
    this.sweep();

    this.logger.log(
      `${room} opening kind=${ctx.kind} client=${ctx.rootSid} root=${legs.rootSid} agent=${legs.agentSid} ` +
        `child=${childSid} — redirecting CHILD only, root joins via dial-status`,
    );

    try {
      await this.signalwire.updateCall(childSid, {
        laml: conferenceDoc({
          room,
          role: childSid === legs.agentSid ? 'agent' : 'party',
          // `record` follows the ROOT, never the role.
          isRoot: childSid === legs.rootSid,
          holdUrl,
          // ⚠️ Registered from THIS document and nowhere else. It is emitted exactly once,
          // from our own API call. The root's document comes from a webhook RESPONSE,
          // which SignalWire may retry — registering the callback there would duplicate
          // every join and leave event.
          statusCallback: webhookUrls(process.env).conferenceStatusUrl,
        }),
      });
    } catch (err) {
      // ⚠️ Do NOT delete the record. `updateCall` can time out having actually applied,
      // and then the bridge is already torn down and dial-status is on its way — with no
      // record to find, it would hang the call up. Leave it for the TTL sweep.
      this.logger.error(`${room} child redirect failed: ${String(err)}`);
      throw err;
    }

    this.logger.log(`${room} child ${childSid} redirected`);
    return record;
  }

  private async resolveAddTarget(
    ctx: CallContext,
    target: AddTarget,
  ): Promise<{
    to: string;
    from: string;
    label: string;
    kind: ConferenceParty['kind'];
    notifyUserId?: number;
  }> {
    if ('userId' in target) {
      const sip = sipDialTarget(process.env);
      if (!sip) {
        throw new BadRequestException(
          'No SIP endpoint is configured, so a colleague cannot be added',
        );
      }
      const user = await this.callControl.resolveTarget(
        target.userId,
        ctx.requester.id,
      );
      return {
        to: `sip:${sip}`,
        // ⚠️ Never the support number. `Calls?From={support}` is exactly how a company's
        // timeline is built, so a staff leg sent with it surfaces in a client's feed.
        from: `sip:${sip}`,
        label: user.name,
        kind: 'user',
        notifyUserId: user.id,
      };
    }

    // Everything below dials the PSTN, which needs the company's own caller ID.
    const supportNumber = await this.supportNumberFor(ctx.companyId);

    const phone =
      'phone' in target
        ? target.phone
        : await this.contactNumber(ctx.companyId, target.contactId);
    const label =
      'phone' in target
        ? phone
        : await this.contactLabel(ctx.companyId, target.contactId);

    if (!isE164(phone)) {
      throw new BadRequestException('That is not a valid phone number');
    }
    if (phone === supportNumber) {
      // SignalWire would bridge this into a loop, billed both ways.
      throw new BadRequestException('Cannot add the company’s own number');
    }

    return { to: phone, from: supportNumber, label, kind: 'number' };
  }

  private async supportNumberFor(companyId: number): Promise<string> {
    const row = await this.prisma.supportNumber.findFirst({
      where: { companyId, releasedAt: null },
      orderBy: { id: 'desc' },
      select: { phoneNumber: true },
    });
    if (!row) throw new NotFoundException('This company has no support number');
    return row.phoneNumber;
  }

  /** The contact's number, read from the row — never from the request body. */
  private async contactRow(companyId: number, contactId: number) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, companyId, deletedAt: null },
      select: { name: true, phoneE164: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    if (!contact.phoneE164) {
      throw new BadRequestException(
        `${contact.name} has no number we can dial`,
      );
    }
    return contact;
  }

  private async contactNumber(
    companyId: number,
    contactId: number,
  ): Promise<string> {
    return (await this.contactRow(companyId, contactId)).phoneE164!;
  }

  private async contactLabel(
    companyId: number,
    contactId: number,
  ): Promise<string> {
    return (await this.contactRow(companyId, contactId)).name;
  }

  private async setHold(
    conferenceSid: string,
    party: ConferenceParty,
    held: boolean,
  ): Promise<void> {
    await this.signalwire.updateParticipant(conferenceSid, party.legSid, {
      hold: held,
      ...(held && {
        holdUrl: webhookUrls(process.env).conferenceWaitUrl,
        holdMethod: 'POST' as const,
      }),
    });
  }

  /**
   * Hold or release every party at once. Sequential, so a failure stops the rest.
   *
   * ⚠️ Skips anybody who is not actually IN the room. A party whose phone is still
   * ringing has no participant row, and `updateParticipant` against one is a 404 — which
   * would fail the whole add because somebody else had not picked up yet. They cannot
   * overhear anything from a room they have not joined, so skipping them is also correct
   * and not merely convenient.
   *
   * `present` omitted means "hold them all" — used by `merge`, which runs on a settled
   * room and wants to release everybody.
   */
  private async holdAll(
    conferenceSid: string,
    record: ConferenceRecord,
    held: boolean,
    present?: SwParticipant[],
  ): Promise<void> {
    const inRoom = present ? new Set(present.map((p) => p.callSid)) : null;
    for (const party of record.parties) {
      if (inRoom && !inRoom.has(party.legSid)) continue;
      await this.setHold(conferenceSid, party, held);
    }
  }

  /**
   * The live room for a name, if there is one.
   *
   * ⚠️ NO server-side `Status` filter, deliberately. `in-progress` was excluding a room
   * that had not reported itself yet, and — more importantly — asking for only the live
   * rows HIDES the `completed` ones, which are the evidence that a room has split. This
   * account has already ignored one documented query filter (`DateCreated<` on
   * /Recordings), so filtering client-side is also the safer habit here.
   */
  private async pickRoom(room: string): Promise<string | null> {
    const rows = await this.signalwire.listConferences({ friendlyName: room });
    const usable = rows.filter((r) => r.status !== 'completed');

    if (usable.length > 1) {
      // The alarm for the failure that made this whole fix necessary: two rooms with one
      // name, each holding one leg, neither able to hear the other.
      //
      // Detection only. LaML addresses a conference by NAME, so there is no way to steer
      // a leg to a particular sid — an honest loud log beats a repair that cannot work.
      this.logger.error(
        `${room} SPLIT ROOM: ${usable.length} live rooms share this name — ` +
          usable.map((r) => `${r.sid}:${r.status}`).join(', '),
      );
    }

    // Prefer a started room over one still initialising.
    return (
      usable.find((r) => r.status === 'in-progress')?.sid ??
      usable[0]?.sid ??
      null
    );
  }

  /** The room takes a moment to materialise after the first leg joins it. */
  /**
   * The room for an ALREADY-ASSEMBLED conference — hold, swap, merge and drop.
   *
   * Unlike `awaitRoom` there is nothing to wait for here: these run on a live call, so a
   * missing room means the conference really has ended and saying so immediately beats
   * making the agent watch a spinner for eight seconds.
   *
   * Prefers the sid the status callback already told us, which costs no request at all.
   */
  private async requireRoomSid(record: ConferenceRecord): Promise<string> {
    const sid = record.conferenceSid ?? (await this.pickRoom(record.room));
    if (!sid) {
      throw new BadRequestException('That call is no longer in a conference');
    }
    record.conferenceSid = sid;
    return sid;
  }

  /**
   * Wait until the room exists AND every leg that matters is actually in it.
   *
   * ⚠️ "The conference row exists" is NOT the condition worth waiting for. The caller's
   * next move is to hold the peer, and `updateParticipant` against somebody who has not
   * joined is a 404 — so the wait has to be on PARTICIPANTS.
   *
   * On timeout the record is deliberately KEPT: a retry then finds `existing`, skips the
   * redirect entirely, and simply waits again. Deleting it here would leave the root's
   * dial-status with nothing to join.
   */
  private async awaitRoom(
    record: ConferenceRecord,
    requiredLegs: string[],
  ): Promise<{ sid: string; participants: SwParticipant[] }> {
    const started = Date.now();
    let lastSid: string | null = null;
    let lastPresent: string[] = [];

    for (let i = 0; i < ConferenceService.ROOM_LOOKUP_ATTEMPTS; i += 1) {
      const sid = await this.pickRoom(record.room);
      lastSid = sid;

      if (sid) {
        const participants = await this.signalwire.listParticipants(sid);
        const present = new Set(participants.map((p) => p.callSid));
        lastPresent = [...present];
        if (requiredLegs.every((leg) => present.has(leg))) {
          this.logger.log(
            `${record.room} resolved sid=${sid} after ${i + 1} attempt(s) ` +
              `(${Date.now() - started}ms) participants=[${lastPresent.join(', ')}]`,
          );
          return { sid, participants };
        }
      }

      this.logger.debug(
        `${record.room} attempt ${i + 1}/${ConferenceService.ROOM_LOOKUP_ATTEMPTS} ` +
          `sid=${sid ?? 'none'} present=[${lastPresent.join(', ')}] ` +
          `waiting for=[${requiredLegs.join(', ')}]`,
      );
      if (i < ConferenceService.ROOM_LOOKUP_ATTEMPTS - 1) {
        await new Promise((r) =>
          setTimeout(r, ConferenceService.ROOM_LOOKUP_DELAY_MS),
        );
      }
    }

    this.logger.error(
      `${record.room} never assembled after ${Date.now() - started}ms — ` +
        `sid=${lastSid ?? 'none'} present=[${lastPresent.join(', ')}] ` +
        `expected=[${requiredLegs.join(', ')}]`,
    );
    throw new BadRequestException(
      'Still connecting everyone to the call — try again in a moment',
    );
  }

  private async viewOf(
    record: ConferenceRecord,
    conferenceSid: string,
  ): Promise<ConferenceView> {
    const participants = await this.signalwire.listParticipants(conferenceSid);

    // Which legs are still real calls? Only asked for parties that have NOT yet appeared
    // as participants — that is the only case where "ringing" and "gone" differ, and it
    // keeps the common path to one provider request.
    const missing = record.parties.filter(
      (p) => !participants.some((row) => row.callSid === p.legSid),
    );
    const live = new Set<string>();
    for (const party of missing) {
      const call = await this.signalwire.getCall(party.legSid).catch(() => null);
      if (call && (call.status === 'queued' || call.status === 'ringing')) {
        live.add(party.legSid);
      }
    }

    return conferenceStateOf(participants, record, live);
  }

  private inactive(): ConferenceView {
    return {
      active: false,
      parties: [],
      merged: true,
      canAdd: false,
      canSwap: false,
    };
  }

  private requireRecord(rootSid: string): ConferenceRecord {
    const record = this.conferences.get(rootSid);
    if (!record) {
      throw new NotFoundException('That call is not in a conference');
    }
    return record;
  }

  private requireParty(
    record: ConferenceRecord,
    partyId: string,
  ): ConferenceParty {
    const party = record.parties.find((p) => p.id === partyId);
    if (!party) throw new NotFoundException('That person is not on this call');
    return party;
  }

  private sweep(): void {
    const cutoff = Date.now() - ConferenceService.TTL_MS;
    for (const [sid, record] of this.conferences) {
      if (record.at < cutoff) this.conferences.delete(sid);
    }
  }
}
