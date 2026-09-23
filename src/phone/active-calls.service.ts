import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { SignalWireService } from './signalwire.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import type { SwCall } from './signalwire-parse.js';
import { legNumber } from './phone-timeline.util.js';
import {
  ACTIVE_CALL_TTL_MS,
  LIVE_LOOKBACK_MS,
  TERMINAL_RETRY_MS,
  busyMessage,
  entryFromLiveRow,
  isExpired,
  liveOnly,
  needsReconcile,
  shouldClear,
  type ActiveCall,
} from './active-calls.util.js';

/** Returned by `claim`. Exactly one of the two is expected to be called. */
export interface ActiveCallClaim {
  /** The call was created; the entry now carries its sid. */
  commit(callSid: string): void;
  /** The dial failed; the line is free again. */
  release(): void;
}

/**
 * Which companies' lines are on a call right now — so every other user can see it, and so
 * nobody dials out from a number that is already in use.
 *
 * ── WHY THIS IS NEEDED AT ALL ───────────────────────────────────────────────────
 * Every browser registers ONE shared SIP credential. A second click-to-call on a busy line
 * rings every open browser, including the one already on the call, which is the origin of
 * the forked-twin bugs. And nothing server-side knew a call was live: `ringingByCompany`
 * covers an inbound ring only, for 40s, and `voice/status` only fires when a call ENDS.
 *
 * ── TWO SOURCES, EACH COVERING THE OTHER'S GAP ─────────────────────────────────
 * The in-memory map is instant, knows WHO is on the call, and closes the race between two
 * clicks (check-and-set happens before any await). SignalWire's `/Calls` is the truth: it
 * survives a restart and cannot be fooled by a forked call's dead twin. So a dial is
 * refused if EITHER says busy, and an entry is only ever removed once SignalWire lists
 * nothing live on the number.
 *
 * In-memory is safe because the server is one PM2 process — the same assumption
 * `ConferenceService` and `PhoneEventsService` make.
 */
@Injectable()
export class ActiveCallsService {
  private readonly logger = new Logger(ActiveCallsService.name);
  /**
   * companyId → every live call on that company's line, oldest first.
   *
   * ⚠️ A LIST, because call waiting makes "two calls on one number" a normal state rather
   * than an impossibility. It used to be one entry per company, and a second inbound ring
   * REPLACED the live conversation — so the "On a call · «name»" indicator started naming
   * the new caller while the agent was still talking to the first one.
   *
   * Every single-call behaviour below is deliberately unchanged: with one entry in the
   * list, each method does exactly what it did before.
   */
  private readonly calls = new Map<number, ActiveCall[]>();
  private readonly reconciling = new Set<number>();

  constructor(
    private readonly signalwire: SignalWireService,
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * The line's state changed: tell every browser looking at this company.
   *
   * Content-free, so it needs no audience — `GET /phone/companies/:id/active-call` is
   * what actually answers, behind its own guard. This only says "ask again".
   */
  private announce(companyId: number): void {
    this.realtime.publish('active-call', { companyId });
  }

  /**
   * Reserve the line for an outbound call, or throw 409.
   *
   * ⚠️ Everything up to `calls.set` is synchronous ON PURPOSE. Two clicks landing together
   * both reach this method; the first reserves before its first `await`, so the second
   * sees the entry and is refused. Moving the SignalWire check above the reservation
   * reopens exactly that race.
   */
  async claim(input: {
    companyId: number;
    companyName: string;
    supportNumber: string;
    userId: number;
    peer: string;
  }): Promise<ActiveCallClaim> {
    const { companyId, companyName, supportNumber, userId, peer } = input;
    const now = Date.now();

    const existing = this.current(companyId, now);
    if (existing) {
      this.logger.log(
        `active-call claim REFUSED ${companyName} (#${companyId}) user=${userId}: ` +
          `already ${existing.direction} ${existing.state} sid=${existing.callSid ?? 'dialing'}`,
      );
      throw new ConflictException(busyMessage(companyName, existing, now));
    }

    const entry: ActiveCall = {
      companyId,
      supportNumber,
      callSid: null,
      direction: 'outbound',
      state: 'dialing',
      userId,
      userName: null,
      peer,
      peerName: null,
      startedAt: now,
      answeredAt: null,
      verifiedAt: now,
    };
    // The reservation must land BEFORE the first await, or two clicks both pass the check
    // above. Appending rather than assigning is what keeps a concurrent inbound ring's
    // entry intact — though in practice the check above has already refused this dial.
    this.calls.set(companyId, [...this.list(companyId, now), entry]);

    let live: SwCall[] = [];
    try {
      live = await this.liveCallsOn(supportNumber, now - ACTIVE_CALL_TTL_MS);
    } catch (err) {
      // SignalWire unreachable means createCall is about to fail anyway. Refusing here
      // would only turn its real error into a misleading "busy".
      this.logger.warn(
        `active-call claim ${companyName}: live check failed, using the in-memory map only: ${String(err)}`,
      );
    }

    if (live.length > 0) {
      // A call we have no entry for: placed before a restart, or outside the app.
      const seeded = entryFromLiveRow(companyId, supportNumber, live[0], Date.now());
      this.replaceEntry(companyId, entry, seeded);
      this.logger.log(
        `active-call claim REFUSED ${companyName} (#${companyId}) user=${userId}: SignalWire lists ` +
          `live [${live.map((c) => `${c.sid}:${c.status}`).join(', ')}] with no entry here — seeded`,
      );
      throw new ConflictException(busyMessage(companyName, seeded, Date.now()));
    }

    await this.fillNames(entry, userId).catch(() => undefined);
    this.logger.log(
      `active-call claim ${companyName} (#${companyId}) user=${userId} -> ${peer}`,
    );

    return {
      commit: (callSid: string) => {
        // Identity, not company: this reservation may no longer be the only entry, and it
        // must never stamp its sid onto somebody else's call.
        if (!this.holds(companyId, entry)) return;
        entry.callSid = callSid;
        entry.state = 'active';
        entry.verifiedAt = Date.now();
        this.logger.log(`active-call commit #${companyId} sid=${callSid}`);
        this.announce(companyId);
      },
      release: () => {
        if (!this.replaceEntry(companyId, entry, null)) return;
        this.logger.log(`active-call release #${companyId} (dial failed)`);
        this.announce(companyId);
      },
    };
  }

  /**
   * An inbound call is ringing somebody. Called beside `broadcastIncomingCall`, so only on
   * the paths that really ring a browser.
   *
   * An OUTBOUND entry is kept: it is the agent's live conversation, and replacing it with a
   * ring would label the line with the wrong call.
   *
   * ⚠️ A second inbound ring is now APPENDED, not substituted. It used to replace whatever
   * inbound entry was there — including an ANSWERED one — so a call waiting on a busy line
   * made the indicator name the new caller while the agent was still mid-conversation with
   * the first. Only a repeat of the SAME sid (a retried webhook) overwrites in place.
   */
  noteInboundRinging(input: {
    companyId: number;
    supportNumber: string;
    callSid: string;
    from: string;
    fromName: string | null;
  }): void {
    const now = Date.now();
    const existing = this.current(input.companyId, now);
    if (existing && existing.direction === 'outbound') {
      this.logger.log(
        `active-call inbound ${input.callSid} rings #${input.companyId} while outbound ` +
          `${existing.callSid ?? 'dialing'} is live — keeping the outbound entry`,
      );
      return;
    }
    const entry: ActiveCall = {
      companyId: input.companyId,
      supportNumber: input.supportNumber,
      callSid: input.callSid,
      direction: 'inbound',
      state: 'ringing',
      userId: null,
      userName: null,
      peer: input.from,
      peerName: input.fromName,
      startedAt: now,
      answeredAt: null,
      verifiedAt: now,
    };
    const others = this.list(input.companyId, now).filter(
      (e) => e.callSid !== input.callSid,
    );
    this.calls.set(input.companyId, [...others, entry]);
    // ⚠️ Announced HERE, not beside `broadcastIncomingCall` in `ringAndDial`. A publish
    // there fires before this line runs, so a browser woken by it refetches
    // `GET .../active-call` and is told the line is free — the stale answer then sits in
    // its cache with nothing left to dislodge it until the 4s poll.
    this.announce(input.companyId);
    this.logger.log(
      `active-call inbound ringing #${input.companyId} sid=${input.callSid} from ${input.from}` +
        (others.length ? ` (${others.length} already live — call waiting)` : ''),
    );
  }

  /**
   * A browser answered an inbound call. Only UPDATES an existing entry with the same sid —
   * never creates one — so the route behind it cannot be used to mark a line busy.
   */
  async markAnswered(
    companyId: number,
    callSid: string,
    userId: number,
  ): Promise<boolean> {
    // By SID, never "the company's entry": with a second call ringing in, the one being
    // answered is not necessarily the one a single-valued lookup would return.
    const entry = this.list(companyId, Date.now()).find(
      (e) => e.callSid === callSid,
    );
    if (!entry || entry.direction !== 'inbound') return false;
    entry.state = 'active';
    entry.answeredAt = Date.now();
    entry.userId = userId;
    await this.fillNames(entry, userId).catch(() => undefined);
    this.logger.log(
      `active-call answered #${companyId} sid=${callSid} by user ${userId}`,
    );
    // "On a call · «name»" is drawn from this entry, so the banner names the right person
    // at once instead of on the next 4s poll.
    this.announce(companyId);
    return true;
  }

  /**
   * The entry for a company, or null. Looking at a stale entry re-checks it in the
   * background, so a missed webhook cannot leave a line marked busy forever.
   */
  get(companyId: number): ActiveCall | null {
    const now = Date.now();
    const entry = this.current(companyId, now);
    if (this.list(companyId, now).some((e) => needsReconcile(e, now))) {
      void this.reconcile(companyId).catch(() => undefined);
    }
    return entry;
  }

  /**
   * A call finished (`voice/status`, terminal). Matched by sid, or else by the support
   * number on either end — which is how a forked click-to-call's LIVE twin, whose sid we
   * never learned, still finds its entry.
   */
  async onTerminalStatus(callSid: string, to: string, from: string): Promise<void> {
    const companyId = this.findCompany(callSid, to, from);
    if (companyId === null) return;

    // With SEVERAL calls live on this line, `reconcile` cannot help: it can only ask
    // whether ANYTHING is still live on the number, and something always is. This
    // callback names the leg that ended, so it is the only thing that can say which entry
    // to drop. Deliberately skipped while a single entry remains, so the forked-twin
    // recipe below — where the named sid is the DEAD twin and the live one keeps the line
    // busy — behaves exactly as it did before.
    if (this.list(companyId, Date.now()).length > 1) {
      this.dropSid(companyId, callSid);
    }

    const kept = await this.reconcile(companyId);
    if (kept) {
      // `/Calls` can lag the callback by a moment. One more look, not a poll.
      const retry = setTimeout(
        () => void this.reconcile(companyId).catch(() => undefined),
        TERMINAL_RETRY_MS,
      );
      retry.unref?.();
    }
  }

  /**
   * Ask SignalWire whether anything is still live on the number; delete the entry if not.
   * Returns whether an entry remains. Never throws: an unreachable provider keeps the line
   * marked busy until the next look, which is the safe direction for a hard block.
   */
  async reconcile(companyId: number): Promise<boolean> {
    const entries = this.list(companyId, Date.now());
    const entry = entries[0];
    if (!entry) return false;
    if (this.reconciling.has(companyId)) return true;
    this.reconciling.add(companyId);
    try {
      const live = await this.liveCallsOn(
        entry.supportNumber,
        Math.min(...entries.map((e) => e.startedAt)) - LIVE_LOOKBACK_MS,
      );
      const still = this.list(companyId, Date.now());
      if (still.length === 0) return false;

      const now = Date.now();
      // `shouldClear` is per entry (it protects a dial in flight and the grace window),
      // but `live.length` is the whole NUMBER — so this clears the entries that may go and
      // keeps the rest, rather than being all-or-nothing across the company.
      const kept = still.filter((e) => !shouldClear(e, live.length, now));
      if (kept.length !== still.length) {
        if (kept.length === 0) this.calls.delete(companyId);
        else this.calls.set(companyId, kept);
        this.logger.log(
          `active-call reconcile #${companyId} cleared ${still.length - kept.length} ` +
            `(nothing live on ${entry.supportNumber})`,
        );
        // The line just freed up — this is the one that clears a stale "on a call".
        this.announce(companyId);
        if (kept.length === 0) return false;
      }
      for (const e of kept) e.verifiedAt = now;
      this.logger.log(
        `active-call reconcile #${companyId} kept ${kept.map((e) => e.state).join('+')} live=[` +
          `${live.map((c) => `${c.sid}:${c.status}`).join(', ')}]`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `active-call reconcile #${companyId} failed, keeping the entry: ${String(err)}`,
      );
      return true;
    } finally {
      this.reconciling.delete(companyId);
    }
  }

  /** Is this exact entry still in the company's list? Identity, never equality. */
  private holds(companyId: number, entry: ActiveCall): boolean {
    return this.calls.get(companyId)?.includes(entry) ?? false;
  }

  /**
   * Swap one entry for another in place, or remove it when `next` is null.
   *
   * In place, so a concurrent inbound ring recorded alongside it is not lost — the reason
   * the old `calls.set(companyId, seeded)` could not simply be kept.
   */
  private replaceEntry(
    companyId: number,
    entry: ActiveCall,
    next: ActiveCall | null,
  ): boolean {
    const entries = this.calls.get(companyId);
    if (!entries?.includes(entry)) return false;
    const updated = entries.flatMap((e) =>
      e === entry ? (next ? [next] : []) : [e],
    );
    if (updated.length === 0) this.calls.delete(companyId);
    else this.calls.set(companyId, updated);
    return true;
  }

  /** Every unexpired entry for a company, oldest first, sweeping the expired ones out. */
  private list(companyId: number, now: number): ActiveCall[] {
    const entries = this.calls.get(companyId);
    if (!entries) return [];
    const live = entries.filter((e) => !isExpired(e, now));
    if (live.length !== entries.length) {
      this.logger.warn(
        `active-call #${companyId} expired ${entries.length - live.length} entr(y/ies) ` +
          `after ${ACTIVE_CALL_TTL_MS / 3_600_000}h with no end seen`,
      );
      if (live.length === 0) this.calls.delete(companyId);
      else this.calls.set(companyId, live);
    }
    return live;
  }

  /**
   * The ONE entry a single-valued reader should be shown.
   *
   * An answered conversation outranks a ring: with a second call ringing in on a busy
   * line, "«name» is on a call" is the useful answer and "an incoming call is ringing" is
   * not — the ring already has its own surface in the overlay. Newest wins within a tier.
   */
  private current(companyId: number, now: number): ActiveCall | null {
    const live = this.list(companyId, now);
    if (live.length === 0) return null;
    const rank = (e: ActiveCall) => (e.state === 'ringing' ? 0 : 1);
    return [...live].sort(
      (a, b) => rank(b) - rank(a) || b.startedAt - a.startedAt,
    )[0];
  }

  private findCompany(callSid: string, to: string, from: string): number | null {
    if (callSid) {
      for (const entry of this.everyEntry()) {
        if (entry.callSid === callSid) return entry.companyId;
      }
    }
    const numbers = new Set(
      [legNumber(to), legNumber(from)].filter((n): n is string => !!n),
    );
    for (const entry of this.everyEntry()) {
      if (numbers.has(entry.supportNumber)) return entry.companyId;
    }
    return null;
  }

  private *everyEntry(): Generator<ActiveCall> {
    for (const entries of this.calls.values()) yield* entries;
  }

  /**
   * Forget the entry naming this sid. Used only when a company has SEVERAL calls live: a
   * terminal callback is then the only thing that says which of them ended, because
   * `reconcile` can only ask whether ANYTHING is still live on the number.
   */
  private dropSid(companyId: number, callSid: string): boolean {
    const entries = this.calls.get(companyId);
    if (!entries) return false;
    const kept = entries.filter((e) => e.callSid !== callSid);
    if (kept.length === entries.length) return false;
    if (kept.length === 0) this.calls.delete(companyId);
    else this.calls.set(companyId, kept);
    this.logger.log(`active-call #${companyId} dropped ended call ${callSid}`);
    return true;
  }

  /** Every live leg with this number on either end. Two requests: `/Calls` ANDs To and From. */
  private async liveCallsOn(number: string, since: number): Promise<SwCall[]> {
    const [fromRows, toRows] = await Promise.all([
      this.signalwire.listCalls({ from: number, after: since }),
      this.signalwire.listCalls({ to: number, after: since }),
    ]);
    const bySid = new Map<string, SwCall>();
    for (const row of [...fromRows, ...toRows]) bySid.set(row.sid, row);
    return liveOnly([...bySid.values()]);
  }

  private async fillNames(entry: ActiveCall, userId: number): Promise<void> {
    const [user, peerName] = await Promise.all([
      this.prisma.user.findFirst({ where: { id: userId }, select: { name: true } }),
      entry.peer
        ? this.contacts.nameForNumber(entry.companyId, entry.peer)
        : Promise.resolve(null),
    ]);
    if (entry.userId === userId) entry.userName = user?.name ?? null;
    if (peerName) entry.peerName = peerName;
  }
}
