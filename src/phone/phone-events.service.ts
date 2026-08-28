import { Injectable, Logger } from '@nestjs/common';
import type { Subject } from 'rxjs';

/** What the browser needs to render an incoming-call popup. */
export interface IncomingCallEvent {
  type: 'incoming-call';
  companyId: number;
  companyName: string;
  /** The caller's number, E.164 as SignalWire reports it. */
  from: string;
  callSid: string;
  /** Epoch ms, so a client can discard an event it receives late. */
  at: number;
}

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
  private pending = new Map<number, IncomingCallEvent>();

  /** A ringing call is only interesting for as long as it could still be ringing. */
  private static readonly PENDING_TTL_MS = 60_000;

  /** The call ringing this user right now, or null. Expired entries are dropped. */
  takePending(userId: number): IncomingCallEvent | null {
    const event = this.pending.get(userId);
    if (!event) return null;
    if (Date.now() - event.at > PhoneEventsService.PENDING_TTL_MS) {
      this.pending.delete(userId);
      return null;
    }
    return event;
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
  broadcastIncomingCall(userIds: number[], event: IncomingCallEvent) {
    const data = JSON.stringify(event);
    const targets = new Set(userIds);

    // Record it FIRST, so a client that fetches the moment its INVITE lands always
    // finds it — the fetch is the reliable path; the stream below is an optimisation
    // for networks where SSE actually works.
    for (const id of targets) this.pending.set(id, event);

    let delivered = 0;
    for (const [, client] of this.clients) {
      if (targets.has(client.userId)) {
        client.subject.next({ data });
        delivered++;
      }
    }
    this.logger.log(
      `incoming-call ${event.from} -> ${event.companyName}: ` +
        `${targets.size} target user(s), ${delivered} open stream(s)`,
    );
  }
}
