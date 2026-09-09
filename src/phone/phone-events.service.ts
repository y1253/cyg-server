import { Injectable, Logger } from '@nestjs/common';
import type { Subject } from 'rxjs';

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
   */
  private pending = new Map<number, CallEvent>();

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
  private ringingByCompany = new Map<number, CallEvent>();

  /**
   * A little longer than the `<Dial timeout="30">` the inbound webhook sends, so an
   * entry cannot outlive the ring it describes by much. `voice/status` clears it the
   * moment the call actually ends; this is only the backstop for a status callback that
   * never arrives.
   */
  private static readonly RINGING_TTL_MS = 40_000;

  /** A ringing call is only interesting for as long as it could still be ringing. */
  private static readonly PENDING_TTL_MS = 60_000;

  /** The call ringing this user right now, or null. Expired entries are dropped. */
  takePending(userId: number): CallEvent | null {
    const event = this.pending.get(userId);
    if (!event) return null;
    if (Date.now() - event.at > PhoneEventsService.PENDING_TTL_MS) {
      this.pending.delete(userId);
      return null;
    }
    return event;
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
   * By user id rather than by call sid because on an INBOUND transfer the transferrer's
   * stale entry and the transferee's brand-new one carry the SAME `callSid` — a sid sweep
   * here would delete the ring it is meant to deliver.
   */
  clearPendingFor(userId: number): void {
    if (this.pending.delete(userId)) {
      this.logger.log(`pending cleared for user ${userId}`);
    }
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
    const event = this.ringingByCompany.get(companyId);
    if (!event) return null;
    if (Date.now() - event.at > PhoneEventsService.RINGING_TTL_MS) {
      this.ringingByCompany.delete(companyId);
      return null;
    }
    if (viewerId !== undefined && event.transferFrom?.id === viewerId)
      return null;
    return event;
  }

  /**
   * Forget a ringing call once it has ended.
   *
   * Keyed on the call sid rather than the company so a status callback for an OLDER call
   * cannot wipe a newer one that started while the first was wrapping up.
   */
  clearRinging(callSid: string): void {
    for (const [companyId, event] of this.ringingByCompany) {
      if (event.callSid === callSid) {
        this.ringingByCompany.delete(companyId);
        this.logger.log(
          `ringing cleared for company ${companyId} (${callSid})`,
        );
        break;
      }
    }

    // AFTER the loop, which breaks on the first match. `pending` is keyed by user, so a
    // finished call can be left behind in several entries at once — a ring group leaves
    // one per member. Any of those is enough for an idle colleague to pair a LATER
    // unmarked INVITE, since `tryPair` never matches on call sid. Safe to sweep by sid
    // here specifically because `voice/status` only fires on a terminal status: the call
    // really is over, so no entry naming it can still be wanted.
    for (const [userId, event] of this.pending) {
      if (event.callSid === callSid) this.pending.delete(userId);
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
   */
  broadcastIncomingCall(userIds: number[], event: CallEvent) {
    const data = JSON.stringify(event);
    const targets = new Set(userIds);

    // Record it FIRST, so a client that fetches the moment its INVITE lands always
    // finds it — the fetch is the reliable path; the stream below is an optimisation
    // for networks where SSE actually works.
    for (const id of targets) this.pending.set(id, event);

    // Inbound only. An outbound call auto-answers on the browser that placed it, so
    // publishing it as "ringing" would offer everyone else an Answer button for a call
    // that is already connected.
    if (event.type === 'incoming-call') {
      this.ringingByCompany.set(event.companyId, event);
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
   * Deliberately reuses the same `pending` slot and the same fan-out as an inbound
   * call: a user can only be on one call at a time, and the client's pairing logic
   * (`tryPair`, and the `pending-call` fetch it falls back to) then works unchanged.
   * That reuse is the whole payoff of originating the call through the REST API
   * rather than sending an INVITE from the browser.
   */
  broadcastOutgoingCall(userId: number, event: CallEvent) {
    this.broadcastIncomingCall([userId], event);
  }
}
