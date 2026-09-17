import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

/** An inbound SMS as the webhook received it. Signature already verified. */
export interface InboundSms {
  to: string;
  from: string;
  body: string;
}

/** A recording taken off an intercepted WhatsApp verification call. */
export interface InboundVoiceCode {
  /** The support number Meta called — how the pending row is found. */
  to: string;
  from: string;
  callSid: string;
  /** Present when SignalWire requested the `action` URL; absent on the sweep path. */
  recordingSid: string | null;
  /**
   * When the call STARTED, so a recording from a previous attempt cannot be used against
   * a row that has since asked for a fresh code.
   */
  startedAt: number;
}

/**
 * What the browser needs to render the call popup.
 *
 * Covers both directions. An outbound call reaches the browser as an ordinary INVITE
 * too — click-to-call rings the shared SIP credential first and only then dials the
 * customer — so the INVITE alone cannot say whether the user is being called or is
 * placing a call. `direction` is what tells the overlay to show "Calling…" with no
 * Answer button instead of a ringing incoming call.
 */
export interface CallEvent {
  type: 'incoming-call' | 'outgoing-call';
  direction: 'inbound' | 'outbound';
  companyId: number;
  companyName: string;
  /** The caller's number on an inbound call; our support number on an outbound one. */
  from: string;
  /**
   * The saved contact's name for `from`, when this company has one.
   *
   * One more optional field rather than a variant of this interface, per the note below:
   * absent on every call where nobody has saved the number, which is most of them, and
   * the card falls back to formatting `from`. Never a substitute for `from` itself —
   * "call back" needs the number.
   */
  fromName?: string;
  /** The number being dialled. Only meaningful outbound. */
  to?: string;
  callSid: string;
  /** Epoch ms, so a client can discard an event it receives late. */
  at: number;
  /**
   * INTERNAL (staff-to-staff) calls only: the value of the X-Cyg-Call SIP header carried
   * on this recipient's leg.
   *
   * An internal call has two legs and BOTH fork to every registered browser, because
   * every browser shares one SIP credential. tryPair() does not match on call sid, so
   * without something to tell the legs apart the callee can answer the CALLER's leg —
   * intermittently, which is the worst way to find out. The callee's browser pairs only
   * the INVITE whose header matches this; the caller's pairs only one with no header.
   *
   * Absent on company calls, which have a single leg per browser and need no marker.
   */
  token?: string;
  /**
   * Set only when this ring is the result of a TRANSFER: who handed the call over.
   *
   * Built server-side from the authenticated requester, never from a request body.
   * `CallOverlay` renders it as an extra line, so an event without it is displayed
   * exactly as before — which is every call that is not a transfer.
   *
   * Deliberately one more optional field rather than a discriminated union, matching how
   * `token` was added: every existing consumer keeps compiling and keeps behaving.
   */
  transferFrom?: { id: number; name: string };
  /**
   * Which calling feature this event came from, so the client knows WHICH transfer
   * endpoint to POST to — `/phone/companies/:id/...` or `/internal-calls/...`.
   *
   * `SoftphoneContext` has branched on this since transfer shipped, but nothing ever
   * emitted it, so every internal transfer went to the company route and failed
   * `assertCallBelongsTo` (an internal call touches no support number). Optional so an
   * older client build keeps compiling; absent is treated as `'company'`.
   *
   * ⚠️ NOT the same thing as `CallKind` (`inbound | outbound | internal`) in
   * `call-legs.util.ts`, which says which LEG the agent is on. Both are called "kind" and
   * both live in this module — map between them explicitly, never by passing one through.
   */
  kind?: 'company' | 'internal';
}

/** @deprecated Kept as an alias while callers migrate to `CallEvent`. */
export type IncomingCallEvent = CallEvent;

/**
 * Per-user push for phone events, modelled on `InternalMessagesService`'s SSE registry
 * (a flat `Map<clientId, {userId, subject}>`, fanned out by scanning).
 *
 * ── WHY THIS EXISTS AT ALL ─────────────────────────────────────────────────────
 * Every browser shares one SIP credential, so every browser receives every INVITE and
 * the INVITE itself says nothing about which company was dialled — its identity is the
 * shared credential. This stream is what tells a given browser "this call is for
 * company X, and you are one of its targets". The popup is gated on THIS, never on the
 * INVITE.
 *
 * In-process memory, like the two existing SSE registries: it does not survive a
 * restart and would not work across multiple Node instances. Acceptable for the same
 * reason theirs is — a dropped event costs one missed popup, and the client reconnects.
 */
@Injectable()
export class PhoneEventsService {
  private readonly logger = new Logger(PhoneEventsService.name);

  /**
   * Every inbound SMS to any support number, AFTER its signature was verified.
   *
   * The one way a module that depends on PhoneModule can react to a text without
   * PhoneModule depending on it back — WhatsApp's number verification reads Meta's code
   * from here. Subscribers must not throw: `next` runs synchronously inside the webhook.
   */
  readonly smsReceived$ = new Subject<InboundSms>();

  emitSms(sms: InboundSms): void {
    try {
      this.smsReceived$.next(sms);
    } catch (err) {
      this.logger.warn(`an SMS subscriber threw: ${String(err)}`);
    }
  }

  // ── Meta's verification CALL ────────────────────────────────────────────────
  //
  // When a WhatsApp number cannot be verified by text, Meta is asked to phone the support
  // number and read the code aloud. That call arrives at `voice/inbound` like any other,
  // where it must be RECORDED rather than rung through to a member of staff — so the
  // webhook needs a synchronous answer to "is this line expecting a robot right now?".
  //
  // It lives here, beside `ringingByCompany`, because this service already owns exactly
  // this kind of state: ephemeral, call-scoped, TTL'd, in-process. Putting it here also
  // keeps the dependency one-way — WhatsApp writes the expectation and subscribes to the
  // recording; PhoneModule still knows nothing about WhatsApp.

  /** How many calls one pending verification may divert before it stops trying. */
  private static readonly MAX_VOICE_CODE_CALLS = 3;

  private voiceCodeExpectations = new Map<
    string,
    { requestedAt: number; expiresAt: number; taken: number }
  >();

  /**
   * "Meta is about to call this number with a code."
   *
   * ⚠️ The TTL is deliberately much shorter than the 15 minutes a pending row is given
   * before it is declared failed. Those are two different clocks: the row can afford to
   * wait, but every minute this is armed is a minute an ordinary client calling that
   * company gets a recording instead of a person.
   */
  expectVoiceCode(e164: string, ttlMs: number): void {
    const now = Date.now();
    this.voiceCodeExpectations.set(e164, {
      requestedAt: now,
      expiresAt: now + ttlMs,
      taken: 0,
    });
    this.logger.log(`expecting a WhatsApp verification call on ${e164}`);
  }

  clearVoiceCode(e164: string): void {
    this.voiceCodeExpectations.delete(e164);
  }

  /**
   * Should an inbound call to this number be recorded as a verification code?
   *
   * Synchronous and allocation-free: it runs on EVERY inbound call, before anything else
   * in the webhook. Consumes one of the attempts, so a chatty line cannot cost three
   * transcriptions, and a lapsed expectation cleans itself up here rather than needing a
   * sweep of its own.
   */
  takeVoiceCodeExpectation(e164: string): { requestedAt: number } | null {
    const found = this.voiceCodeExpectations.get(e164);
    if (!found) return null;
    if (Date.now() > found.expiresAt) {
      this.voiceCodeExpectations.delete(e164);
      return null;
    }
    if (found.taken >= PhoneEventsService.MAX_VOICE_CODE_CALLS) {
      this.logger.warn(
        `WhatsApp verification call limit reached on ${e164} — letting calls through`,
      );
      this.voiceCodeExpectations.delete(e164);
      return null;
    }
    found.taken += 1;
    return { requestedAt: found.requestedAt };
  }

  /**
   * A recording made on an intercepted verification call.
   *
   * The twin of `smsReceived$`, and for the same reason: WhatsApp subscribes, PhoneModule
   * does not learn what WhatsApp is.
   */
  readonly voiceCodeRecorded$ = new Subject<InboundVoiceCode>();

  emitVoiceCode(event: InboundVoiceCode): void {
    try {
      this.voiceCodeRecorded$.next(event);
    } catch (err) {
      this.logger.warn(`a voice-code subscriber threw: ${String(err)}`);
    }
  }

  private clients = new Map<
    string,
    { userId: number; subject: Subject<{ data: string }> }
  >();

  /**
   * The call currently ringing each user, readable over a NORMAL HTTP request.
   *
   * ── WHY THIS EXISTS ALONGSIDE THE SSE STREAM ───────────────────────────────
   * SSE cannot be relied on. The office network runs a TLS-intercepting content
   * filter ("Geder Filter" re-signs the certificate), and filters of that kind buffer
   * a response until it completes before forwarding it. A normal API call is
   * unaffected — it completes — but an event stream never does, so the browser never
   * even receives the response headers and sits at readyState CONNECTING forever.
   * Verified: normal API 200 in 76ms, while BOTH the phone stream and the pre-existing
   * internal-messages stream hang indefinitely from inside that network.
   *
   * The SIP WebSocket does get through (registration succeeds and INVITEs arrive), so
   * the call itself is fine — only the metadata channel was broken. A short-lived
   * record the client can FETCH on a normal request works everywhere.
   *
   * ⚠️ A LIST per user, not one slot. It used to be `Map<number, CallEvent>` on the
   * stated grounds that "a user can only be on one call at a time" — which call waiting
   * is precisely the removal of. A second ring for the same agent overwrote the first,
   * so the browser asking `/pending-call` while holding call 1's INVITE could be handed
   * call 2's event and pair the wrong company onto it.
   */
  private pending = new Map<number, CallEvent[]>();

  /**
   * The call ringing each COMPANY right now, readable by anyone entitled to that
   * company's phone — not just the users it was routed to.
   *
   * ── WHY THIS EXISTS ALONGSIDE `pending` ────────────────────────────────────
   * `pending` is keyed by user id and only ever written for the routed targets, which
   * for an assigned company is the assigned user alone. An admin who opens that company
   * while it is ringing is not a target, so nothing in `pending` can tell them a call is
   * happening — even though their browser IS holding a live, answerable INVITE, because
   * every browser shares one SIP credential.
   *
   * This index is what closes that gap. It does NOT change routing: an unassigned admin
   * still gets no popup and is not interrupted. It only lets them pick the call up while
   * they are looking at that company.
   */
  private ringingByCompany = new Map<number, CallEvent[]>();

  /**
   * A little longer than the `<Dial timeout="30">` the inbound webhook sends, so an
   * entry cannot outlive the ring it describes by much. `voice/status` clears it the
   * moment the call actually ends; this is only the backstop for a status callback that
   * never arrives.
   */
  private static readonly RINGING_TTL_MS = 40_000;

  /** A ringing call is only interesting for as long as it could still be ringing. */
  private static readonly PENDING_TTL_MS = 60_000;

  /** Ceiling on either list, newest kept. See `withEvent`. */
  private static readonly MAX_EVENTS_PER_KEY = 8;

  /**
   * Every call ringing this user right now, newest first. Expired entries are dropped.
   *
   * The list is what call waiting runs on. An agent already on a call still has call 1's
   * event here when call 2 arrives, and the browser needs BOTH to decide which INVITE
   * belongs to which company — it is holding two of them.
   */
  takeAllPending(userId: number): CallEvent[] {
    return this.livePending(userId);
  }

  /**
   * The NEWEST call ringing this user, or null.
   *
   * Kept beside `takeAllPending` because `GET /phone/pending-call` still answers in this
   * shape for client builds that predate call waiting. This is an installed PWA; a cached
   * build has to keep working.
   */
  takePending(userId: number): CallEvent | null {
    return this.takeAllPending(userId)[0] ?? null;
  }

  /** This user's unexpired events, newest first, sweeping the expired ones out as it goes. */
  private livePending(userId: number): CallEvent[] {
    const events = this.pending.get(userId);
    if (!events) return [];
    const cutoff = Date.now() - PhoneEventsService.PENDING_TTL_MS;
    const live = events.filter((e) => e.at > cutoff);
    if (live.length === 0) this.pending.delete(userId);
    else if (live.length !== events.length) this.pending.set(userId, live);
    return live;
  }

  /**
   * Forget the call ringing THIS user, without waiting for the TTL.
   *
   * The one caller is a blind transfer, and it closes a real hole. `takePending` is a
   * PEEK — it deletes only already-expired entries — so after handing a call over, the
   * transferring agent's ORIGINAL event sits in this map for its full 60s. Their browser
   * then receives the transfer `<Dial><Sip>` fork (every browser shares one SIP
   * credential), asks `GET /pending-call`, is handed that stale event back, and pairs it:
   * they are rung by the call they just gave away, labelled with the original caller.
   *
   * Scoped to (user, sid) — never a global sid sweep, and no longer the whole user. On an
   * INBOUND transfer the transferrer's stale entry and the transferee's brand-new one
   * carry the SAME `callSid`, so sweeping by sid alone would delete the ring it is meant
   * to deliver; and now that an agent can hold several calls at once, dropping every
   * entry for the user would blind them to the calls they did NOT transfer.
   *
   * `callSid` is optional only so an omitted argument still means "all of this user's",
   * which is what the pre-call-waiting behaviour was.
   */
  clearPendingFor(userId: number, callSid?: string): void {
    const events = this.pending.get(userId);
    if (!events) return;
    const kept = callSid ? events.filter((e) => e.callSid !== callSid) : [];
    if (kept.length === events.length) return;
    if (kept.length === 0) this.pending.delete(userId);
    else this.pending.set(userId, kept);
    this.logger.log(
      `pending cleared for user ${userId}${callSid ? ` (${callSid})` : ''}`,
    );
  }

  /**
   * The call ringing this company right now, or null. Expired entries are dropped.
   *
   * `viewerId` is not authorization — the route has already done that. It suppresses one
   * specific case: the agent who just TRANSFERRED this call away. They are idle again and
   * their browser is holding a fork of the transfer `<Dial>`, so without this the banner
   * invites them to take back the call they deliberately handed over. Suppressing it here
   * rather than in the client covers their other tabs too.
   */
  getRinging(companyId: number, viewerId?: number): CallEvent | null {
    for (const event of this.liveRinging(companyId)) {
      if (viewerId !== undefined && event.transferFrom?.id === viewerId)
        continue;
      return event;
    }
    return null;
  }

  /** This company's unexpired rings, newest first, sweeping the expired ones out. */
  private liveRinging(companyId: number): CallEvent[] {
    const events = this.ringingByCompany.get(companyId);
    if (!events) return [];
    const cutoff = Date.now() - PhoneEventsService.RINGING_TTL_MS;
    const live = events.filter((e) => e.at > cutoff);
    if (live.length === 0) this.ringingByCompany.delete(companyId);
    else if (live.length !== events.length)
      this.ringingByCompany.set(companyId, live);
    return live;
  }

  /**
   * Add an event to a list, replacing any entry with the same sid, newest kept.
   *
   * The cap is not about how many calls an agent may juggle — the client decides that —
   * but about this map being in-process memory fed by a public webhook. Without it a run
   * of unanswered calls grows a user's list until the TTL catches up.
   */
  private withEvent(existing: CallEvent[], event: CallEvent): CallEvent[] {
    const others = existing.filter((e) => e.callSid !== event.callSid);
    // Prepended, and the list is thereafter maintained newest-first by INSERTION rather
    // than re-sorted on `at`. Two calls can share a millisecond — they do in the tests,
    // and a ring group broadcasts several at once — and a sort on equal keys leaves the
    // order to whatever the caller happened to do first. Insertion order is the fact we
    // actually have.
    return [event, ...others].slice(0, PhoneEventsService.MAX_EVENTS_PER_KEY);
  }

  /**
   * Forget a ringing call once it has ended.
   *
   * Keyed on the call sid rather than the company so a status callback for an OLDER call
   * cannot wipe a newer one that started while the first was wrapping up.
   */
  clearRinging(callSid: string): void {
    // No `break` any more: a company can have several calls ringing at once, and removing
    // only the first match would strand the finished one under a live sibling.
    for (const [companyId, events] of [...this.ringingByCompany]) {
      const kept = events.filter((e) => e.callSid !== callSid);
      if (kept.length === events.length) continue;
      if (kept.length === 0) this.ringingByCompany.delete(companyId);
      else this.ringingByCompany.set(companyId, kept);
      this.logger.log(`ringing cleared for company ${companyId} (${callSid})`);
    }

    // `pending` is keyed by user, so a finished call can be left behind in several
    // entries at once — a ring group leaves one per member. Any of those is enough for an
    // idle colleague to pair a LATER unmarked INVITE, since `tryPair` falls back to order
    // when an INVITE carries no marker. Safe to sweep by sid here specifically because
    // `voice/status` only fires on a terminal status: the call really is over, so no
    // entry naming it can still be wanted. The agent's OTHER calls are untouched.
    for (const [userId, events] of [...this.pending]) {
      const kept = events.filter((e) => e.callSid !== callSid);
      if (kept.length === events.length) continue;
      if (kept.length === 0) this.pending.delete(userId);
      else this.pending.set(userId, kept);
    }
  }

  addClient(id: string, userId: number, subject: Subject<{ data: string }>) {
    this.clients.set(id, { userId, subject });
  }

  removeClient(id: string) {
    this.clients.delete(id);
  }

  /** Open streams for a user — used to log when a call rings nobody who is looking. */
  isConnected(userId: number): boolean {
    for (const [, c] of this.clients) if (c.userId === userId) return true;
    return false;
  }

  /**
   * Fan an incoming call out to exactly the users who should see it.
   *
   * Note this decides only what is DISPLAYED. The call itself is already ringing every
   * registered browser, because they all share one SIP credential — which is why a
   * non-target client must ignore its INVITE rather than reject it.
   *
   * ⚠️ `publishToCompany` defaults to TRUE, which is the behaviour every existing caller
   * wants: an ordinary inbound call should raise the in-tab Answer banner for anyone
   * viewing that company, so an admin can pick it up when the assigned user is away.
   *
   * Add-call passes FALSE, and must. The added leg is an ordinary `incoming-call` event,
   * so publishing it would offer the Answer button to any idle viewer of the company —
   * and answering would drop a person who was never invited into a live client
   * conference. The targeted user still gets their own `pending` entry either way.
   */
  broadcastIncomingCall(
    userIds: number[],
    event: CallEvent,
    opts: { publishToCompany?: boolean } = {},
  ) {
    const data = JSON.stringify(event);
    const targets = new Set(userIds);

    // Record it FIRST, so a client that fetches the moment its INVITE lands always
    // finds it — the fetch is the reliable path; the stream below is an optimisation
    // for networks where SSE actually works.
    //
    // APPENDED, not assigned: an agent may already be on a call, and overwriting their
    // entry is what used to make a second call unpairable. Re-broadcasting the same sid
    // replaces that one entry rather than duplicating it, so a retried webhook is a
    // no-op.
    for (const id of targets)
      this.pending.set(id, this.withEvent(this.livePending(id), event));

    // Inbound only. An outbound call auto-answers on the browser that placed it, so
    // publishing it as "ringing" would offer everyone else an Answer button for a call
    // that is already connected.
    if (event.type === 'incoming-call' && opts.publishToCompany !== false) {
      this.ringingByCompany.set(
        event.companyId,
        this.withEvent(this.liveRinging(event.companyId), event),
      );
    }

    let delivered = 0;
    for (const [, client] of this.clients) {
      if (targets.has(client.userId)) {
        client.subject.next({ data });
        delivered++;
      }
    }
    this.logger.log(
      `${event.type} ${event.direction === 'outbound' ? (event.to ?? '?') : event.from}` +
        ` -> ${event.companyName}: ` +
        `${targets.size} target user(s), ${delivered} open stream(s)`,
    );
  }

  /**
   * Announce a call this user just placed, to that user alone.
   *
   * Deliberately reuses the same `pending` list and the same fan-out as an inbound call,
   * so the client's pairing logic (`tryPair`, and the `pending-calls` fetch it falls back
   * to) works unchanged. That reuse is the whole payoff of originating the call through
   * the REST API rather than sending an INVITE from the browser.
   *
   * It used to rest on "a user can only be on one call at a time". That is no longer true
   * — call waiting lets an agent hold several — which is exactly why the slot became a
   * list: an outbound call placed while another is parked must not erase it.
   */
  broadcastOutgoingCall(userId: number, event: CallEvent) {
    this.broadcastIncomingCall([userId], event);
  }
}
