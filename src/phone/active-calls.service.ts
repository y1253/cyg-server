import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ContactsService } from '../contacts/contacts.service.js';
import { SignalWireService } from './signalwire.service.js';
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
  private readonly calls = new Map<number, ActiveCall>();
  private readonly reconciling = new Set<number>();

  constructor(
    private readonly signalwire: SignalWireService,
    private readonly prisma: PrismaService,
    private readonly contacts: ContactsService,
  ) {}

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
    this.calls.set(companyId, entry);

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
      if (this.calls.get(companyId) === entry) this.calls.set(companyId, seeded);
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
        if (this.calls.get(companyId) !== entry) return;
        entry.callSid = callSid;
        entry.state = 'active';
        entry.verifiedAt = Date.now();
        this.logger.log(`active-call commit #${companyId} sid=${callSid}`);
      },
      release: () => {
        if (this.calls.get(companyId) !== entry) return;
        this.calls.delete(companyId);
        this.logger.log(`active-call release #${companyId} (dial failed)`);
      },
    };
  }

  /**
   * An inbound call is ringing somebody. Called beside `broadcastIncomingCall`, so only on
   * the paths that really ring a browser.
   *
   * An OUTBOUND entry is kept: it is the agent's live conversation, and replacing it with a
   * ring would label the line with the wrong call. A stale inbound entry is replaced.
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
    this.calls.set(input.companyId, {
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
    });
    this.logger.log(
      `active-call inbound ringing #${input.companyId} sid=${input.callSid} from ${input.from}`,
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
    const entry = this.current(companyId, Date.now());
    if (!entry || entry.direction !== 'inbound' || entry.callSid !== callSid) {
      return false;
    }
    entry.state = 'active';
    entry.answeredAt = Date.now();
    entry.userId = userId;
    await this.fillNames(entry, userId).catch(() => undefined);
    this.logger.log(
      `active-call answered #${companyId} sid=${callSid} by user ${userId}`,
    );
    return true;
  }

  /**
   * The entry for a company, or null. Looking at a stale entry re-checks it in the
   * background, so a missed webhook cannot leave a line marked busy forever.
   */
  get(companyId: number): ActiveCall | null {
    const now = Date.now();
    const entry = this.current(companyId, now);
    if (entry && needsReconcile(entry, now)) {
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
    const entry = this.calls.get(companyId);
    if (!entry) return false;
    if (this.reconciling.has(companyId)) return true;
    this.reconciling.add(companyId);
    try {
      const live = await this.liveCallsOn(
        entry.supportNumber,
        entry.startedAt - LIVE_LOOKBACK_MS,
      );
      if (this.calls.get(companyId) !== entry) return this.calls.has(companyId);

      const now = Date.now();
      if (shouldClear(entry, live.length, now)) {
        this.calls.delete(companyId);
        this.logger.log(
          `active-call reconcile #${companyId} cleared (nothing live on ${entry.supportNumber})`,
        );
        return false;
      }
      entry.verifiedAt = now;
      this.logger.log(
        `active-call reconcile #${companyId} kept ${entry.state} live=[` +
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

  private current(companyId: number, now: number): ActiveCall | null {
    const entry = this.calls.get(companyId);
    if (!entry) return null;
    if (isExpired(entry, now)) {
      this.calls.delete(companyId);
      this.logger.warn(
        `active-call #${companyId} expired after ${ACTIVE_CALL_TTL_MS / 3_600_000}h with no end seen`,
      );
      return null;
    }
    return entry;
  }

  private findCompany(callSid: string, to: string, from: string): number | null {
    if (callSid) {
      for (const entry of this.calls.values()) {
        if (entry.callSid === callSid) return entry.companyId;
      }
    }
    const numbers = new Set(
      [legNumber(to), legNumber(from)].filter((n): n is string => !!n),
    );
    for (const entry of this.calls.values()) {
      if (numbers.has(entry.supportNumber)) return entry.companyId;
    }
    return null;
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
