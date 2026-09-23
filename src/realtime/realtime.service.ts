import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';
import type {
  RealtimeBatch,
  RealtimeEvent,
  RealtimePublishOptions,
  RealtimeTopic,
} from './realtime.types.js';

/**
 * How long a request may be parked before it answers empty.
 *
 * ⚠️ This is the number the whole transport turns on. The office network runs a
 * TLS-intercepting filter that BUFFERS a response until it completes before forwarding
 * it — which is why all three `@Sse` streams hang at readyState CONNECTING from inside
 * it (verified; see `PhoneEventsService`'s docblock). A long poll is immune for exactly
 * one reason: the response COMPLETES, so the filter forwards it. It must therefore
 * finish comfortably inside every idle timeout between the browser and Node — nginx's
 * `proxy_read_timeout` on `/api` above all.
 */
const HOLD_MS = 25_000;

/** Events retained for resume. A client 25s behind is ~1 poll behind, never 500 events. */
const MAX_BUFFER = 500;

/** Older than this and a resuming client is told to resync instead. */
const EVENT_TTL_MS = 2 * 60_000;

/**
 * Parked requests allowed at once. Past this, a request answers empty immediately and
 * the client re-asks — degrading to a poll rather than growing the heap without bound.
 */
const MAX_WAITERS = 2_000;

interface Waiter {
  userId: number;
  since: number;
  resolve: (batch: RealtimeBatch) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The server half of the real-time channel: a sequenced ring buffer of invalidation
 * signals plus the long-poll requests parked on it.
 *
 * ── WHY THIS MODULE IMPORTS NOTHING ────────────────────────────────────────────
 * `PhoneModule` is imported BY `CommunicationsModule`, `InternalCallsModule`,
 * `WhatsAppModule` and `CompaniesModule`, which is why `PhoneEventsService`'s rxjs
 * subjects exist at all — they are the one-way channel around that cycle. This service
 * has to be injectable from every one of those modules AND from the ones they import,
 * so it takes no dependencies of its own. A dependency-free `@Global()` provider cannot
 * participate in a cycle. Keep it that way: the moment this injects Prisma or any
 * feature service, half the publish sites become unreachable.
 *
 * ⚠️ State is IN-PROCESS, exactly like `PhoneEventsService.clients` and the SSE
 * registries. It does not survive a restart (clients resync via `reset`) and it does not
 * cross Node instances — so PM2 must run `backend` in FORK mode, not cluster. In cluster
 * mode a browser would only ever see events published by the worker its poll landed on.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);

  private seq = 0;
  private buffer: RealtimeEvent[] = [];
  private waiters = new Set<Waiter>();

  /**
   * The same events, for services INSIDE this process.
   *
   * A module that caches something a topic invalidates subscribes here to drop it — which
   * is how `UnreadFeedService` reacts to an inbound text or WhatsApp message without
   * `PhoneModule` or `WhatsAppModule` being able to import it (CommunicationsModule is
   * what imports them, so the edge only runs one way). Same role as
   * `PhoneEventsService`'s subjects, and the reason this service takes no dependencies.
   */
  readonly events$ = new Subject<RealtimeEvent>();

  /**
   * Announce that something changed.
   *
   * ⚠️ **Bust the server cache that serves this data BEFORE calling me.** A client woken
   * by this refetches within milliseconds; if the 55s unread-feed entry or the 45s phone
   * window is still warm it is handed the very answer the event said was stale, and the
   * row flickers back. That is the trap `lib/unreadFeedDismiss.ts` documents and the
   * ordering `PhoneWebhooksController.freshenFor` already calls load-bearing.
   *
   * Never throws. Every caller is a webhook handler or a service method whose real work
   * has already succeeded, and a notification failure must not undo it — the same rule
   * `PhoneEventsService.emitSms` and friends follow.
   */
  publish(topic: RealtimeTopic, opts: RealtimePublishOptions = {}): void {
    try {
      const event: RealtimeEvent = {
        seq: ++this.seq,
        at: Date.now(),
        topic,
        ...(opts.companyId !== undefined ? { companyId: opts.companyId } : {}),
        ...(opts.userIds ? { userIds: opts.userIds } : {}),
        ...(opts.payload !== undefined ? { payload: opts.payload } : {}),
      };

      this.buffer.push(event);
      this.sweep();

      // ⚠️ ORDER IS LOAD-BEARING, and it is the same rule as the docblock above.
      // In-process subscribers are the ones that DROP CACHES; browsers are the ones that
      // immediately re-read through them. Waking a browser first races its refetch
      // against the bust that was supposed to precede it — and a lost race re-pins the
      // stale answer for another full TTL, with nothing left to dislodge it.
      this.notify(event);
      this.wake(event);
    } catch (err) {
      this.logger.warn(`publish ${topic} failed: ${String(err)}`);
    }
  }

  /**
   * Answer a long poll: everything this user has not seen, or park until there is
   * something — whichever comes first.
   */
  wait(userId: number, since: number, holdMs = HOLD_MS): Promise<RealtimeBatch> {
    const cursor = since > 0 ? since : 0;

    // A brand-new client with a backlog behind it is handed the cursor at once and skips
    // the backlog: it has nothing stale to invalidate, its queries were fetched on mount.
    //
    // ⚠️ Gated on there BEING a backlog. On a freshly started server `seq` is 0 too, and
    // answering `since=0` immediately there would return `{seq: 0}` to a client that
    // re-asks with `since=0` — a tight loop hammering the server until the first event.
    if (cursor === 0 && this.seq > 0) {
      return Promise.resolve({ seq: this.seq, events: [] });
    }

    const immediate = this.batchFor(userId, cursor);
    if (immediate.reset || immediate.events.length > 0) {
      return Promise.resolve(immediate);
    }

    if (this.waiters.size >= MAX_WAITERS) {
      this.logger.warn(`waiter cap reached (${MAX_WAITERS}); answering empty`);
      return Promise.resolve({ seq: this.seq, events: [] });
    }

    return new Promise<RealtimeBatch>((resolve) => {
      const waiter: Waiter = {
        userId,
        since: cursor,
        resolve,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          resolve({ seq: this.seq, events: [] });
        }, holdMs),
      };
      this.waiters.add(waiter);
    });
  }

  /** Parked requests right now. For the health route and the spec. */
  get waiterCount(): number {
    return this.waiters.size;
  }

  /** The cursor a client would be handed if it connected now. */
  get cursor(): number {
    return this.seq;
  }

  /** One throwing subscriber must not cost the others, nor the browsers behind them. */
  private notify(event: RealtimeEvent): void {
    try {
      this.events$.next(event);
    } catch (err) {
      this.logger.warn(`a realtime subscriber threw: ${String(err)}`);
    }
  }

  private wake(event: RealtimeEvent): void {
    for (const waiter of [...this.waiters]) {
      if (!visibleTo(event, waiter.userId)) continue;
      this.waiters.delete(waiter);
      clearTimeout(waiter.timer);
      waiter.resolve(this.batchFor(waiter.userId, waiter.since));
    }
  }

  /**
   * What this user has missed since `since`, or a `reset` when that cannot be answered.
   *
   * The three ways `since` fails to be answerable, and each matters:
   *   - `since > seq`   the server restarted and the counter went backwards;
   *   - buffer empty while `since < seq`  everything they missed has aged out;
   *   - buffer's oldest event is newer than `since + 1`  a gap was evicted.
   * A quiet system is NOT one of them: with `since === seq` there is simply nothing to
   * send, which is the common case and must park rather than resync — including the
   * `since === seq === 0` case, a first client on a server that has published nothing.
   */
  private batchFor(userId: number, since: number): RealtimeBatch {
    if (since > this.seq) return { seq: this.seq, events: [], reset: true };
    if (since === this.seq) return { seq: this.seq, events: [] };

    const oldest = this.buffer[0];
    if (!oldest || oldest.seq > since + 1) {
      return { seq: this.seq, events: [], reset: true };
    }

    const events = this.buffer.filter(
      (e) => e.seq > since && visibleTo(e, userId),
    );
    return { seq: this.seq, events };
  }

  private sweep(): void {
    const cutoff = Date.now() - EVENT_TTL_MS;
    let from = 0;
    while (from < this.buffer.length && this.buffer[from].at < cutoff) from++;
    if (this.buffer.length - from > MAX_BUFFER) {
      from = this.buffer.length - MAX_BUFFER;
    }
    if (from > 0) this.buffer = this.buffer.slice(from);
  }
}

/**
 * An event with no `userIds` is for everybody; one with them is for exactly those users.
 *
 * Exported for the spec, because "who may see this" is the only security-relevant line
 * in the file and deserves to be asserted directly rather than through the buffer.
 */
export function visibleTo(event: RealtimeEvent, userId: number): boolean {
  return !event.userIds || event.userIds.includes(userId);
}
