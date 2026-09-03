import {
  isE164,
  isOutbound,
  type SwCall,
  type SwMessage,
} from './signalwire-parse.js';
import type { CallItemDto, PhoneItemDto, SmsItemDto } from './phone.types.js';

/**
 * Turning raw SignalWire legs into inbox rows.
 *
 * Pure and network-free, for the same reason `signalwire-parse.ts` and
 * `compute-next-due.ts` are: every rule in here was derived from probing the live API
 * and each one is wrong in a way that is invisible in the UI — a duplicated row, a
 * missed call shown as answered — rather than an error anyone would notice.
 */

/** Namespaced ids. See PhoneItemBase.id for why these exist. */
export const CALL_ID_PREFIX = 'swcall:';
export const SMS_ID_PREFIX = 'swsms:';

export const callItemId = (sid: string) => `${CALL_ID_PREFIX}${sid}`;
export const smsItemId = (sid: string) => `${SMS_ID_PREFIX}${sid}`;

/**
 * Is this one of ours, and well-formed?
 *
 * The read/complete endpoints take an item id from the client and write it straight
 * into the shared state tables. Without this check that endpoint is an arbitrary
 * `messageId` writer — someone could mark another company's email complete, or fill
 * the table with junk. Bounded length because the column is VARCHAR(500).
 */
export function isPhoneItemId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^sw(call|sms):[A-Za-z0-9_.-]{1,120}$/.test(value)
  );
}

/**
 * The phone number inside a SIP URI, or null when there is not one.
 *
 * SignalWire wraps numbers on SIP legs: the parent leg of our own click-to-call reports
 * `from: "sip:+14382561210@sip.signalwire.com"`, not the bare `+14382561210`. A plain
 * equality check against the support number therefore fails on exactly the leg that
 * carries the recording, which is what made every outbound recording unreachable.
 *
 * Returns null for a URI whose user part is not a number (`sip:testcyg@…`), so callers
 * can treat "not a phone leg" and "a different phone number" the same way.
 */
export function e164FromSipUri(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const match = /^sips?:(\+[1-9]\d{7,14})@/i.exec(value.trim());
  return match ? match[1] : null;
}

/** A leg endpoint as a bare E.164 number, whether or not it arrived SIP-wrapped. */
export function legNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return isE164(trimmed) ? trimmed : e164FromSipUri(trimmed);
}

/**
 * The customer's number on a leg, or null if this leg is not about our number.
 *
 * Returning null is what removes the parent leg of our own click-to-call. That leg is
 * `To: sip:{shared}@{domain}`, `From: {support number}` — so it MATCHES the
 * `From={support}` query, and rendering it would put a second, nonsense row next to
 * every outbound call. Its counterparty is a SIP URI rather than a phone number, so
 * the E.164 test drops it while keeping the `outbound-dial` child leg, which carries
 * the real customer number.
 */
export function counterpartyOfCall(
  call: SwCall,
  supportNumber: string,
): { counterparty: string; direction: 'inbound' | 'outbound' } | null {
  if (call.to === supportNumber && isE164(call.from)) {
    return { counterparty: call.from, direction: 'inbound' };
  }
  if (call.from === supportNumber && isE164(call.to)) {
    return { counterparty: call.to, direction: 'outbound' };
  }
  return null;
}

/** Same rule for a message. SMS legs are always plain numbers, but be consistent. */
export function counterpartyOfMessage(
  msg: SwMessage,
  supportNumber: string,
): { counterparty: string; direction: 'inbound' | 'outbound' } | null {
  if (msg.to === supportNumber && isE164(msg.from)) {
    return { counterparty: msg.from, direction: 'inbound' };
  }
  if (msg.from === supportNumber && isE164(msg.to)) {
    return { counterparty: msg.to, direction: 'outbound' };
  }
  return null;
}

/** Statuses that mean the leg never connected. */
const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);
/** Statuses that mean the call is still up. */
const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);

/**
 * What actually happened on a call.
 *
 * ── WHY THIS NEEDS THE CHILD LEG ───────────────────────────────────────────────
 * An inbound call that nobody answers reports `status: completed` on the leg our
 * `To={support}` query returns — the `<Dial>` verb ran to completion; the fact that it
 * rang out is recorded on the SIP leg it created. Verified live:
 *
 *   parent  to=+14382561210  from=+14384933567  direction=inbound        status=completed
 *   child   to=sip:testcyg@…                     direction=outbound-dial  status=no-answer
 *
 * So reading the parent alone marks every missed call "answered" — the single most
 * visible thing this feature could get wrong, since a missed call is the one a user
 * needs to act on.
 *
 * `child` is the SIP leg whose `parentCallSid` is this call, when one exists. An
 * inbound call with NO child never reached the `<Dial>` at all (an unknown number, or
 * a company with nobody to ring, gets the spoken holding message) — also a miss.
 */
export function callOutcome(
  call: SwCall,
  direction: 'inbound' | 'outbound',
  child: SwCall | undefined,
): CallItemDto['outcome'] {
  if (LIVE.has(call.status)) return 'in-progress';

  if (direction === 'inbound') {
    if (!child) return 'missed';
    if (UNCONNECTED.has(child.status)) return 'missed';
    if (child.status === 'failed') return 'failed';
    return child.durationSec > 0 ? 'answered' : 'missed';
  }

  // Outbound: the leg we hold IS the customer leg, so its own status is the truth.
  if (call.status === 'failed') return 'failed';
  if (UNCONNECTED.has(call.status)) return 'missed';
  return call.durationSec > 0 ? 'answered' : 'missed';
}

export interface BuildInput {
  supportNumber: string;
  /** Legs from the To/From queries on the support number. */
  calls: SwCall[];
  /** Legs from the `To=sip:…` query — account-wide, matched by parentCallSid. */
  sipLegs: SwCall[];
  messages: SwMessage[];
  /** Call sids that have a recording. */
  recordedCallSids: Set<string>;
  /** Item ids marked read. Outbound items are read regardless. */
  readIds: Set<string>;
  /** Item ids marked completed. */
  completedIds: Set<string>;
}

/**
 * Raw legs → inbox rows, newest first.
 *
 * De-dupes by sid before anything else: a leg where our number is BOTH `to` and
 * `from` would otherwise arrive from two queries and render twice.
 */
export function buildPhoneItems(input: BuildInput): PhoneItemDto[] {
  const {
    supportNumber,
    calls,
    sipLegs,
    messages,
    recordedCallSids,
    readIds,
    completedIds,
  } = input;

  const childByParent = new Map<string, SwCall>();
  const childSidsByParent = new Map<string, string[]>();
  for (const leg of sipLegs) {
    if (!leg.parentCallSid) continue;
    // Several legs can share a parent when a <Dial> rings more than one target; the
    // one that connected is the interesting one, so a connected leg always wins.
    const existing = childByParent.get(leg.parentCallSid);
    if (!existing || (existing.durationSec === 0 && leg.durationSec > 0)) {
      childByParent.set(leg.parentCallSid, leg);
    }
    const sids = childSidsByParent.get(leg.parentCallSid) ?? [];
    sids.push(leg.sid);
    childSidsByParent.set(leg.parentCallSid, sids);
  }

  /**
   * Does this displayed row have a recording?
   *
   * A recording belongs to the leg the `<Dial>` verb ran on, which is NOT always the leg
   * we show:
   *
   *   inbound   — `<Dial>` runs on the leg we display, so the sids match directly.
   *   outbound  — click-to-call's `<Dial>` runs on the PARENT (`to=sip:{shared}@…`), and
   *               that parent is dropped from the feed as a duplicate. The row we show is
   *               its child, so the recording is found through `parentCallSid`.
   *
   * Checking own → parent → children covers both without assuming which, and the child
   * legs are already in the window for `callOutcome`, so it costs no extra request.
   * Verified live: recording `adda8eb7…` sits on call `bdddc88b…`, the SIP parent of the
   * `outbound-dial` leg the timeline renders.
   */
  const hasRecordingFor = (call: SwCall): boolean => {
    if (recordedCallSids.has(call.sid)) return true;
    if (call.parentCallSid && recordedCallSids.has(call.parentCallSid))
      return true;
    return (childSidsByParent.get(call.sid) ?? []).some((sid) =>
      recordedCallSids.has(sid),
    );
  };

  const items: PhoneItemDto[] = [];
  // Keyed on the NAMESPACED id, not the raw sid. SignalWire sids carry no type
  // prefix, so a shared `seen` set on bare sids would silently drop a message whose
  // sid matched a call's — defeating the very collision the namespace exists for.
  const seen = new Set<string>();

  for (const call of calls) {
    const id = callItemId(call.sid);
    if (seen.has(id)) continue;
    const resolved = counterpartyOfCall(call, supportNumber);
    if (!resolved) continue;
    seen.add(id);

    // Hoisted: `outcome` and `hasVoicemail` must agree about whether this call was
    // answered, and computing it twice invites them to drift.
    const outcome = callOutcome(
      call,
      resolved.direction,
      childByParent.get(call.sid),
    );
    const recorded = hasRecordingFor(call);

    const item: CallItemDto = {
      id,
      sid: call.sid,
      kind: 'call',
      direction: resolved.direction,
      counterparty: resolved.counterparty,
      supportNumber,
      status: call.status,
      // Kept on the DTO so the detail view knows where to look for the audio when the
      // recording is on the parent leg rather than this one.
      parentCallSid: call.parentCallSid,
      outcome,
      durationSec: call.durationSec,
      hasRecording: recorded,
      // See CallItemDto.hasVoicemail for why this is derivable. `outcome` has already
      // done the hard part by reading the SIP child leg rather than this one.
      //
      // INBOUND ONLY, and not merely as a tidy-up: a voicemail is something a CALLER
      // left us. On an outbound leg `record-from-answer-dual` produces nothing when the
      // customer never answers, so in practice this cannot fire -- but the recording
      // lookup also searches the parent SIP leg, which the agent's own browser answered,
      // and one unlucky match there would label a call we placed a message they left.
      hasVoicemail:
        resolved.direction === 'inbound' && outcome === 'missed' && recorded,
      at: new Date(call.startedAt).toISOString(),
      // You cannot have an unread call you placed yourself.
      isRead: resolved.direction === 'outbound' || readIds.has(id),
      isCompleted: completedIds.has(id),
    };
    items.push(item);
  }

  for (const msg of messages) {
    const id = smsItemId(msg.sid);
    if (seen.has(id)) continue;
    const resolved = counterpartyOfMessage(msg, supportNumber);
    if (!resolved) continue;
    seen.add(id);

    const item: SmsItemDto = {
      id,
      sid: msg.sid,
      kind: 'sms',
      direction: resolved.direction,
      counterparty: resolved.counterparty,
      supportNumber,
      body: msg.body,
      numMedia: msg.numMedia,
      status: msg.status,
      errorCode: msg.errorCode,
      at: new Date(msg.sentAt).toISOString(),
      isRead: isOutbound(msg.direction) || readIds.has(id),
      isCompleted: completedIds.has(id),
    };
    items.push(item);
  }

  return items.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  );
}
