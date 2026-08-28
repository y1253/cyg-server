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
