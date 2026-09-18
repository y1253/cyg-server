import {
  LIVE,
  MAX_RINGING_MS,
  PRE_ANSWER,
  legNumber,
} from './phone-timeline.util.js';
import type { SwCall } from './signalwire-parse.js';

/**
 * The pure rules behind "this company's line is busy".
 *
 * Kept out of `ActiveCallsService` so every threshold below has a test that needs no
 * SignalWire and no clock.
 */

/** Longest a busy entry may live with nothing re-confirming it. Matches ConferenceService. */
export const ACTIVE_CALL_TTL_MS = 4 * 60 * 60 * 1000;

/** How stale an entry may get, while somebody is looking at it, before SignalWire is asked again. */
export const RECONCILE_EVERY_MS = 30_000;

/**
 * A reconcile never clears an entry younger than this.
 *
 * A call we just created, or an inbound call whose webhook just arrived, can be a moment
 * behind in `/Calls`. Clearing on that gap would un-block the line mid-dial.
 */
export const CLEAR_GRACE_MS = 10_000;

/** How far before an entry's start the live query reaches, for clock skew with SignalWire. */
export const LIVE_LOOKBACK_MS = 10_000;

// Re-exported so this module's own spec and callers keep importing the busy-line rules from
// one place. The definitions live beside LIVE/UNCONNECTED in phone-timeline.util.ts, because
// callOutcome needs the identical rule and duplicating it is how two copies drift.
export { MAX_RINGING_MS, PRE_ANSWER };

/** A terminal callback that finds the call still listed as live asks once more after this. */
export const TERMINAL_RETRY_MS = 5_000;

export interface ActiveCall {
  companyId: number;
  /** The company's number. Lets a status callback be matched without a DB read. */
  supportNumber: string;
  /** Null only while an outbound claim is being dialled. */
  callSid: string | null;
  direction: 'inbound' | 'outbound';
  state: 'dialing' | 'ringing' | 'active';
  /** Who dialled (outbound) or who answered (inbound). */
  userId: number | null;
  userName: string | null;
  /** The customer's number. Empty when it could not be read off a seeded leg. */
  peer: string;
  peerName: string | null;
  /** Dial time (outbound) or ring time (inbound). */
  startedAt: number;
  /** Inbound only, from the answering browser's report. */
  answeredAt: number | null;
  /** Last time SignalWire confirmed (or was assumed to confirm) the call is live. */
  verifiedAt: number;
}

/** What a browser is shown. No support number, no user id. */
export interface ActiveCallView {
  companyId: number;
  callSid: string | null;
  direction: ActiveCall['direction'];
  state: ActiveCall['state'];
  userName: string | null;
  /** The viewer is the person on the call, perhaps in another tab or browser. */
  isViewer: boolean;
  peer: string;
  peerName: string | null;
  /** Computed here, so a browser with a wrong clock still shows the right timer. */
  elapsedSec: number;
}

export function isExpired(entry: ActiveCall, now: number): boolean {
  return now - entry.startedAt > ACTIVE_CALL_TTL_MS;
}

export function needsReconcile(entry: ActiveCall, now: number): boolean {
  return now - entry.verifiedAt > RECONCILE_EVERY_MS;
}

/**
 * May a reconcile that found `liveCount` live legs delete this entry?
 *
 * Never while dialling (the call does not exist on SignalWire yet) and never inside the
 * grace window. Otherwise only when NOTHING on the number is live, which is what makes a
 * forked click-to-call safe: its dead twin's `no-answer` arrives within seconds while the
 * other twin is still `in-progress`.
 */
export function shouldClear(
  entry: ActiveCall,
  liveCount: number,
  now: number,
): boolean {
  if (entry.state === 'dialing') return false;
  if (now - entry.startedAt < CLEAR_GRACE_MS) return false;
  return liveCount === 0;
}

/**
 * The rows that really mean "somebody is on this line".
 *
 * `LIVE.has(status)` alone is not enough: a leg can orphan in a pre-answer status and
 * stay there forever, un-endable. See `MAX_RINGING_MS`.
 */
export function liveOnly(rows: SwCall[], now: number = Date.now()): SwCall[] {
  return rows.filter((row) => {
    if (!LIVE.has(row.status)) return false;
    // An answered call may run as long as it likes.
    if (!PRE_ANSWER.has(row.status)) return true;
    return now - row.startedAt <= MAX_RINGING_MS;
  });
}

/**
 * An entry for a live call SignalWire knows about and we do not — after a restart, or a
 * call placed outside the app. Who is on it cannot be known, so nobody is named.
 */
export function entryFromLiveRow(
  companyId: number,
  supportNumber: string,
  row: SwCall,
  now: number,
): ActiveCall {
  const inbound = legNumber(row.to) === supportNumber;
  const started =
    typeof row.startedAt === 'number' && row.startedAt > 0 ? row.startedAt : now;
  return {
    companyId,
    supportNumber,
    callSid: row.sid,
    direction: inbound ? 'inbound' : 'outbound',
    state: 'active',
    userId: null,
    userName: null,
    // An outbound ROOT leg's `to` is the shared SIP address, which has no number.
    peer: legNumber(inbound ? row.from : row.to) ?? '',
    peerName: null,
    startedAt: started,
    answeredAt: null,
    verifiedAt: now,
  };
}

export function elapsedSecOf(entry: ActiveCall, now: number): number {
  const from = entry.answeredAt ?? entry.startedAt;
  return Math.max(0, Math.floor((now - from) / 1000));
}

export function toView(
  entry: ActiveCall,
  now: number,
  viewerId: number,
): ActiveCallView {
  return {
    companyId: entry.companyId,
    callSid: entry.callSid,
    direction: entry.direction,
    state: entry.state,
    userName: entry.userName,
    isViewer: entry.userId !== null && entry.userId === viewerId,
    peer: entry.peer,
    peerName: entry.peerName,
    elapsedSec: elapsedSecOf(entry, now),
  };
}

/** The 409 text. Read by a person who just clicked Call, so it says what to do. */
export function busyMessage(
  companyName: string,
  entry: ActiveCall,
  now: number,
): string {
  const what =
    entry.direction === 'inbound'
      ? entry.state === 'ringing'
        ? 'an incoming call is ringing'
        : 'an inbound call is in progress'
      : 'an outbound call is in progress';
  const who = entry.userName ? ` (${entry.userName})` : '';
  const minutes = Math.floor(elapsedSecOf(entry, now) / 60);
  const since = minutes >= 1 ? `, ${minutes} min so far` : '';
  return `${companyName}'s line is busy: ${what}${who}${since}. Try again when it ends.`;
}
