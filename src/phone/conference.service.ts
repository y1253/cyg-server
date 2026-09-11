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
  MAX_ADDED_PARTIES,
  type ConferenceParty,
  type ConferenceRecord,
  type ConferenceView,
} from './call-legs.util';
import { conferenceDoc } from './conference-laml.util';
import { isE164 } from './signalwire-parse';
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

  /** How long to keep asking whether the room has materialised after the redirects. */
  private static readonly ROOM_LOOKUP_ATTEMPTS = 3;
  private static readonly ROOM_LOOKUP_DELAY_MS = 200;

  /**
   * Live conferences, keyed by the ROOT sid the client already holds.
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

  // ── The dial-status safety net ─────────────────────────────────────────────

  /**
   * Is this leg a root that still needs moving into its room? One-shot.
   *
   * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
   * Redirecting the child tears down the `<Dial>` bridge, so the root's `<Dial>` ends and
   * SignalWire posts `voice/dial-status`. That route hangs the caller up on
   * `completed` — which, in the ~300 ms before our own redirect of the root lands, would
   * drop the customer at the exact moment somebody was being added.
   *
   * So `dial-status` asks this first. Whichever gets there first — the webhook or the
   * explicit `updateCall` — claims the flag, and the other does nothing. Node is
   * single-threaded and the flag is set BEFORE any await, so the claim is atomic.
   */
  awaitingRootJoin(callSid: string): ConferenceRecord | null {
    for (const record of this.conferences.values()) {
      if (record.rootSid === callSid && !record.rootJoined) {
        record.rootJoined = true;
        return record;
      }
    }
    return null;
  }

  /** The conference one leg belongs to, for the hold-audio webhook. */
  recordForLeg(callSid: string): ConferenceRecord | null {
    for (const record of this.conferences.values()) {
      if (
        record.agentSid === callSid ||
        record.rootSid === callSid ||
        record.parties.some((p) => p.legSid === callSid)
      ) {
        return record;
      }
    }
    return null;
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
    const conferenceSid = await this.requireConferenceSid(record);

    // Dialling somebody new parks whoever you were talking to, exactly as a phone does.
    // BEFORE the new leg is created: if a hold fails after a stranger is already on the
    // line, that stranger is listening to a client who was never put on hold.
    await this.holdAll(conferenceSid, record, true);

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
      `addCall root=${ctx.rootSid} +${resolved.label} (${record.parties.length} parties)`,
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
    const conferenceSid = await this.requireConferenceSid(record);
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
    const conferenceSid = await this.requireConferenceSid(record);
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
    const conferenceSid = await this.requireConferenceSid(record);
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
    const conferenceSid = await this.requireConferenceSid(record);
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

    try {
      const conferenceSid = await this.conferenceSidFor(record.room);
      if (!conferenceSid) {
        this.conferences.delete(rootSid);
        return this.inactive();
      }
      const view = await this.viewOf(record, conferenceSid);
      if (!view.active) this.conferences.delete(rootSid);
      return view;
    } catch (err) {
      this.logger.warn(`conferenceStatus ${rootSid} failed: ${String(err)}`);
      return this.inactive();
    }
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

    const room = conferenceRoomFor(ctx.rootSid);
    const agentIsRoot = legs.agentSid === ctx.rootSid;
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
      rootSid: ctx.rootSid,
      rootJoined: false,
      parties: [peerParty],
      companyId: ctx.companyId,
      nextPartyId: 2,
      at: Date.now(),
    };

    // BEFORE any provider call: this is what arms the dial-status safety net, and the
    // window it covers opens the instant the child is redirected.
    this.conferences.set(ctx.rootSid, record);
    this.sweep();

    const docFor = (sid: string) =>
      conferenceDoc({
        room,
        role: sid === legs.agentSid ? 'agent' : 'party',
        // `record` follows the ROOT, never the role.
        isRoot: sid === ctx.rootSid,
        holdUrl,
        // One document only, or the callback registers several times over and every
        // join and leave arrives duplicated.
        ...(sid === legs.agentSid && {
          statusCallback: webhookUrls(process.env).conferenceStatusUrl,
        }),
      });

    try {
      await this.signalwire.updateCall(childSid, { laml: docFor(childSid) });

      if (!record.rootJoined) {
        record.rootJoined = true;
        await this.signalwire.updateCall(ctx.rootSid, {
          laml: docFor(ctx.rootSid),
        });
      }
    } catch (err) {
      // The legs are mid-move and we no longer know where they are. Drop the record so
      // the client's poll reports inactive rather than offering controls that will fail.
      this.conferences.delete(ctx.rootSid);
      throw err;
    }

    this.logger.log(`conference ${room} opened (kind=${ctx.kind})`);
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

  /** Hold or release every party at once. Sequential, so a failure stops the rest. */
  private async holdAll(
    conferenceSid: string,
    record: ConferenceRecord,
    held: boolean,
  ): Promise<void> {
    for (const party of record.parties) {
      await this.setHold(conferenceSid, party, held);
    }
  }

  private async conferenceSidFor(room: string): Promise<string | null> {
    const rows = await this.signalwire.listConferences({
      friendlyName: room,
      status: 'in-progress',
    });
    return rows[0]?.sid ?? null;
  }

  /** The room takes a moment to materialise after the first leg joins it. */
  private async requireConferenceSid(
    record: ConferenceRecord,
  ): Promise<string> {
    for (let i = 0; i < ConferenceService.ROOM_LOOKUP_ATTEMPTS; i += 1) {
      const sid = await this.conferenceSidFor(record.room);
      if (sid) return sid;
      if (i < ConferenceService.ROOM_LOOKUP_ATTEMPTS - 1) {
        await new Promise((r) =>
          setTimeout(r, ConferenceService.ROOM_LOOKUP_DELAY_MS),
        );
      }
    }
    throw new BadRequestException('That call is no longer in a conference');
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
