import {
  isE164,
  isOutbound,
  type SwCall,
  type SwMessage,
  type SwRecording,
} from './signalwire-parse.js';
import { pickConnectedChild } from './call-legs.util.js';
import type {
  CallItemDto,
  CallOutcome,
  PhoneItemDto,
  SmsItemDto,
} from './phone.types.js';

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
 * Is the AGENT on the root leg, rather than on a child of it?
 *
 * This is `CallKind` asked structurally, and it exists because `direction` cannot answer
 * it. A call TAKEN BACK from a transfer is the counter-example: the leg the agent now
 * holds reports `direction: 'outbound-dial'` — it was dialled outward by the original
 * click-to-call — but it is now the ROOT of a fresh `<Dial><Sip>`, i.e. structurally
 * inbound-shaped, root = customer and child = agent. Classifying it from `direction`
 * inverts the legs, and on a second transfer that redirects the CUSTOMER while calling
 * them the agent: the colleague gets handed the agent and the client is stranded. The
 * same inversion has already cost this module `hasRecording` and `summaryLookupSids`.
 *
 * The discriminator is what the root is TALKING TO. Only the agent's own leg dials a SIP
 * endpoint that is not a phone number; a customer leg always resolves to E.164, wrapped
 * (`sip:+1438…@…`) or bare. Hence `legNumber` rather than a `startsWith('sip:')` test,
 * which the wrapped form defeats.
 */
export function agentIsOnRoot(root: { to: string }): boolean {
  return legNumber(root.to) === null;
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

/**
 * The inbox row this leg WILL be rendered as, or null if it is not rendered at all.
 *
 * ── WHY THIS IS NOT "WHICH DIRECTION IS THE CALL" ──────────────────────────────
 * The obvious way to find a call's row is to branch on `direction`: inbound means the row
 * is the root, outbound means it is the `outbound-dial` child. That is wrong twice over.
 * A leg TAKEN BACK from a transfer reports `direction: 'outbound-dial'` while being
 * structurally inbound-shaped (see `agentIsOnRoot`), and a redirected leg reports whatever
 * the redirect made it. Branching on direction gets both backwards, silently.
 *
 * So ask the only question that decides it: would `buildPhoneItems` emit a row for THIS
 * leg? That is `counterpartyOfCall`, the very predicate the timeline uses — a leg whose
 * counterparty is not an E.164 number is the `outbound-api` SIP parent the timeline drops,
 * and null means "the row is somewhere else; go and find the child".
 *
 * Using the timeline's own rule rather than a second copy of it is the point. This module
 * has already paid for the root/child inversion twice — `hasRecording` reported false on
 * every outbound call, and it came back as `summaryLookupSids`.
 */
export function rowItemIdFor(
  call: SwCall,
  supportNumber: string,
): string | null {
  return counterpartyOfCall(call, supportNumber) ? callItemId(call.sid) : null;
}

/**
 * A filename extension for a content type, for the Content-Disposition of a proxied MMS.
 *
 * Only the handful a carrier actually delivers. An unknown type gets NO extension rather
 * than a guessed one: the browser reads the real type from `Content-Type`, and a wrong
 * extension is worse than none — it is what decides which application opens the file once
 * it has been saved.
 */
const MMS_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/amr': '.amr',
  'audio/ogg': '.ogg',
  'text/vcard': '.vcf',
  'application/pdf': '.pdf',
};

export function extensionForContentType(contentType: string): string {
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MMS_EXTENSIONS[base] ?? '';
}

/** Statuses that mean the leg never connected. */
export const UNCONNECTED = new Set(['no-answer', 'busy', 'canceled', 'failed']);
/** Statuses that mean the call is still up. */
export const LIVE = new Set(['queued', 'initiated', 'ringing', 'in-progress']);

/**
 * Longest a leg may sit PRE-ANSWER before it stops counting as live.
 *
 * ── WHY THIS EXISTS: A LEG CAN ORPHAN, AND THEN NOTHING CAN KILL IT ────────────
 * Verified on the live account. An outbound `<Dial>` to a US number sat at
 * `status: ringing` for 3.5 HOURS after its parent completed — SignalWire never tore it
 * down, despite `<Dial timeout="30">`. Worse, it could not be ended afterwards: BOTH
 * `POST /Calls/{sid}` with `Status=completed` AND a `<Hangup/>` LaML redirect returned
 * 200 and changed nothing (`date_updated` never moved). It is a zombie record, and no
 * amount of hanging up clears it.
 *
 * That leg carries the company's support number, so `liveCallsOn` kept returning it,
 * `shouldClear` never fired, and the company read "…is on a call on this line" with every
 * further dial refused by `claim()` — for the full `ACTIVE_CALL_TTL_MS`, four hours.
 *
 * So this is not a tidy-up. Aging a pre-answer leg out is the ONLY thing that can
 * un-wedge a line once a leg has orphaned: `hangUpCall` stops the orphan being created on
 * a healthy call, and this is what survives one that is not.
 *
 * ── PICKING THE NUMBER ─────────────────────────────────────────────────────────
 * TOO SHORT and a genuinely ringing line reads as free mid-ring, so a second dial could
 * be placed onto it. The longest legitimate ring is `PhoneDialerService.RING_TIMEOUT` /
 * `<Dial timeout>` = 30s, so this is 6x the real ceiling.
 *
 * TOO LONG and the wedge simply persists that long. Today it persists for four hours.
 *
 * ⚠️ `in-progress` is NEVER aged out — a real conversation runs for hours, and clearing
 * one would mark a line free while somebody is still talking on it.
 */
export const MAX_RINGING_MS = 3 * 60 * 1000;

/** Statuses a leg holds BEFORE anybody has answered. Only these may be aged out. */
export const PRE_ANSWER = new Set(['queued', 'initiated', 'ringing']);

/**
 * Does this window still contain a call that has not finished?
 *
 * ── WHY A CACHED WINDOW HAS TO KNOW THIS ──────────────────────────────────────
 * `PhoneTimelineService` holds a window for 45s on the stated grounds that `bust()`, not
 * the TTL, is the freshness mechanism. That is true for every event which CREATES a row —
 * and false for the one that CHANGES one. `bust()` is edge-triggered: `voice/status` fires
 * it once, the very next poll refetches, and if SignalWire's own row has not flipped off
 * `in-progress` yet (it lags the callback by a beat) that stale answer is re-pinned for a
 * further 45 seconds with nothing left to dislodge it. That is the reported "it still says
 * In progress a minute after I hung up".
 *
 * A window holding a live leg is therefore cached briefly instead, so it re-reads itself
 * until the call is actually over. Only companies with a call up pay it.
 */
export function windowHasLiveLeg(calls: SwCall[], sipLegs: SwCall[]): boolean {
  return (
    calls.some((c) => LIVE.has(c.status)) ||
    sipLegs.some((c) => LIVE.has(c.status))
  );
}

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
  now: number = Date.now(),
): CallItemDto['outcome'] {
  // ── A LEG STUCK PRE-ANSWER IS AN ORPHAN, NOT A CALL IN PROGRESS ──────────────
  // An ANSWERED call may run for hours, so `in-progress` is never aged out. But a leg
  // still in a PRE-ANSWER status long past any real ring has been abandoned by the
  // provider: verified on this account, one sat at `ringing` for 8+ HOURS and could not be
  // ended by `Status=completed`, `Status=canceled`, `DELETE` or a `<Hangup/>` redirect —
  // all accepted, `date_updated` never moved. Without this the row reads "In progress"
  // forever. Nobody ever answered it, so it is a miss.
  //
  // ⚠️ The explicit `return 'missed'` is load-bearing. `ringing` is NOT in `UNCONNECTED`,
  // so falling through would reach `durationSec > 0 ? 'answered' : 'missed'` — and a stuck
  // leg's duration is seconds-since-start (29,891 on the one above), which would flip it
  // straight to ANSWERED. That is the very bug this release is fixing elsewhere.
  //
  // Same rule, same constants and same reasoning as `liveOnly` in `active-calls.util.ts`.
  if (LIVE.has(call.status)) {
    if (!PRE_ANSWER.has(call.status)) return 'in-progress';
    if (now - call.startedAt <= MAX_RINGING_MS) return 'in-progress';
    return 'missed';
  }

  if (direction === 'inbound') {
    if (!child) return 'missed';
    // BEFORE the UNCONNECTED test, which also contains 'failed' — below it this line was
    // unreachable and inbound could never report 'failed' at all. Mirrors the outbound
    // branch, which has always checked it first: a dial that failed is a different fact
    // from one nobody picked up, and the row says so.
    if (child.status === 'failed') return 'failed';
    if (UNCONNECTED.has(child.status)) return 'missed';
    return child.durationSec > 0 ? 'answered' : 'missed';
  }

  // Outbound: the leg we hold IS the customer leg, so its own status is the truth.
  if (call.status === 'failed') return 'failed';
  if (UNCONNECTED.has(call.status)) return 'missed';
  return call.durationSec > 0 ? 'answered' : 'missed';
}

/**
 * The shortest recording that can hold anything a person would want to hear.
 *
 * ── WHY A DURATION AT ALL ──────────────────────────────────────────────────────
 * `<Record>` is offered on EVERY unanswered inbound call — `voice/dial-status` takes the
 * voicemail branch for any `DialCallStatus` that is not `completed` — and SignalWire files
 * a Recording resource even when the caller hangs up at the beep. So "a recording exists"
 * and "somebody left a message" are NOT the same fact, and treating them as one labelled
 * every missed call a voicemail.
 *
 * It cannot be settled at the webhook either: SignalWire does not request the `<Record>`
 * `action` URL on a hangup, so `voice/voicemail` — the one handler handed a real
 * `RecordingDuration` — never fires for exactly the case that produces a phantom. Duration
 * is the only signal that survives to the read path.
 *
 * 3s, not 1 or 5: the beep plus the click of a hang-up is about a second, "hi, uh—" is two,
 * and the shortest message anyone actually leaves ("it's Bob, call me back") is four.
 * Tunable without a deploy — see `minRecordingSeconds` in phone.config.ts — because the
 * value can only be calibrated against live traffic, and erring high HIDES a client's
 * message, which is the most expensive thing this feature can do.
 *
 * What it deliberately does NOT catch: a caller who stays silent until the 10s `<Record>`
 * timeout elapses leaves ~10s of silence, which passes any threshold that does not also eat
 * real short messages. A duration rule cannot tell silence from speech, and the transcript —
 * the only thing that can — is behind `PHONE_SUMMARIZE_CALLS`, default off.
 */
export const MIN_RECORDING_SECONDS = 3;

/** States in which a recording will never have audio. */
const RECORDING_DEAD = new Set(['absent', 'failed']);
/** States in which the reported duration is not final yet. */
const RECORDING_UNSETTLED = new Set([
  'in-progress',
  'paused',
  'stopped',
  'processing',
]);

/**
 * Does this recording hold anything?
 *
 * An UNSETTLED recording counts, deliberately: its duration cannot be trusted yet, it
 * settles within seconds, and the 15s poll re-decides. A hang-up at the beep settles as
 * `completed` with a sub-threshold duration and STAYS that way — so the optimistic answer
 * costs at most one poll of a wrong label on a real message, while the pessimistic one
 * would hide real messages for as long as SignalWire takes to process them.
 */
export function isAudibleRecording(
  r: SwRecording,
  minSec: number = MIN_RECORDING_SECONDS,
): boolean {
  if (RECORDING_DEAD.has(r.status)) return false;
  if (RECORDING_UNSETTLED.has(r.status)) return true;
  return r.durationSec >= minSec;
}

/**
 * A call that is READ the moment it appears, with no row in the read-state table.
 *
 * Two cases, and they are one rule rather than two because the table cannot express the
 * difference: read state is "a row exists ⇔ read", so there is no way to record that an
 * implicitly-read call was later marked UNREAD. Both are therefore permanent.
 *
 *  - OUTBOUND, unchanged: you cannot have an unread call you placed yourself.
 *  - INBOUND and ANSWERED: somebody picked it up, which is what reading it would have
 *    meant. `in-progress` counts too — you cannot have an unread call you are on — and it
 *    settles to `answered` on the next poll anyway.
 *
 * `missed` and `failed` stay UNREAD, which is the whole point: a caller nobody reached is
 * the backlog, and unread missed calls are what the dashboard badge, the Missed calls
 * folder, the header pill and the tab badge all count. A VOICEMAIL needs no clause of its
 * own — every voicemail is an inbound `missed` call, the same argument `isUnreadMissedCall`
 * below makes about `hasVoicemail`.
 *
 * ⚠️ Mirrored on the client as `communications/types.ts#isImplicitlyReadCall`, which is
 * what hides the "Mark as unread" control. If the two disagree, that control reappears on
 * a row where pressing it does nothing — it flips optimistically and bounces back on the
 * next refetch.
 */
export function isImplicitlyReadCall(
  direction: 'inbound' | 'outbound',
  outcome: CallOutcome,
): boolean {
  if (direction === 'outbound') return true;
  // An exhaustive switch rather than `outcome === 'answered' || …`, following
  // `getItemTimestamp` and `internal-inbox.ts`. A fifth outcome must be a COMPILE error in
  // both copies of this rule: a boolean expression would silently default it to unread,
  // and the tempting "simplification" to `!== 'missed'` would silently default it to READ,
  // which is how a caller nobody reached stops appearing in the bell.
  switch (outcome) {
    case 'answered':
    case 'in-progress':
      return true;
    case 'missed':
    case 'failed':
      return false;
    default: {
      const never: never = outcome;
      return never;
    }
  }
}

/**
 * An UNREAD MISSED CALL — what the dashboard's "N missed calls" badge, the Communications
 * tab's Missed calls folder and the browser tab badge all count.
 *
 * Voicemails need no clause of their own: `hasVoicemail` is only ever set on an inbound
 * call whose outcome is `missed`, so every voicemail already matches.
 *
 * Inbound only. An outbound call nobody picked up is an attempt WE made, not a caller we
 * owe a response — and it is `isRead: true` by construction anyway, so the clause is
 * belt and braces rather than load-bearing.
 *
 * There are now TWO read rules in this file and they do not overlap: `isImplicitlyReadCall`
 * above decides which calls never enter the unread world at all, and it deliberately leaves
 * `missed` alone — which is what keeps this predicate, and every badge built on it, counting
 * exactly what it counted before.
 *
 * ⚠️ Mirrored on the client as `communications/types.ts#isUnreadMissedCall`. The folder
 * lists rows with that copy and its badge counts with this one, so if the two disagree
 * the list and its number disagree.
 */
export function isUnreadMissedCall(item: PhoneItemDto): boolean {
  return (
    item.kind === 'call' &&
    item.direction === 'inbound' &&
    item.outcome === 'missed' &&
    !item.isRead
  );
}

export interface BuildInput {
  supportNumber: string;
  /** Legs from the To/From queries on the support number. */
  calls: SwCall[];
  /** Legs from the `To=sip:…` query — account-wide, matched by parentCallSid. */
  sipLegs: SwCall[];
  messages: SwMessage[];
  /**
   * Recordings in this window, AS FETCHED — duration and status included.
   *
   * This used to be `recordedCallSids: Set<string>`, and that Set WAS the bug: a caller who
   * hangs up at the beep still leaves a Recording resource behind, so membership alone said
   * "voicemail" for every missed call. The fields that tell a message from a hang-up were
   * fetched and then thrown away one layer up, in the service.
   *
   * Kept as the raw rows rather than a duration map because `source` (RecordVerb vs
   * DialVerb) is the discriminator we would actually prefer if SignalWire reports it — see
   * `scripts/signalwire-recording-probe.mjs`. With the rows in hand that is a one-line
   * change here; with a Set or a number map it is another round of plumbing.
   */
  recordings: SwRecording[];
  /** Override for `MIN_RECORDING_SECONDS`; see `minRecordingSeconds` in phone.config.ts. */
  minRecordingSec?: number;
  /**
   * The clock, so `callOutcome` can tell a leg that is still ringing from one the provider
   * abandoned. A parameter rather than a `Date.now()` inside the loop purely so the spec
   * can pin the boundary.
   */
  now?: number;
  /** Item ids marked read. Outbound items are read regardless. */
  readIds: Set<string>;
  /** Item ids marked completed. */
  completedIds: Set<string>;
  /**
   * E.164 -> the saved contact's name, for this company.
   *
   * An overlay passed in by the caller, exactly like `readIds`/`completedIds`, rather
   * than a lookup performed here: this function stays pure and network-free, and the one
   * query that builds the map is shared by every caller through `itemsFor`.
   */
  contactNames?: Map<string, string>;
}

/**
 * Drop your own replies from an INBOX list.
 *
 * A text you sent is not news. Each one used to get its own row — already read, so it
 * rendered pale, one per reply — and because an outbound row is never `isCompleted`, your
 * own outgoing message also counted toward the UNCOMPLETED badge. Google Chat has always
 * dropped self-sent messages before building a row (`getChats`); this is the same move.
 *
 * The exception is a conversation YOU started that they have not answered. Hide that and
 * the thread becomes unreachable, since a thread is only ever opened from a row. So an
 * outbound text survives exactly while its peer has never written in — and only the newest
 * one does, because three unanswered follow-ups are one conversation, not three.
 *
 * ── ⚠️ WHY THIS IS NOT INSIDE `buildPhoneItems` ───────────────────────────────
 * It was, for one release, and it was a bad bug. That builder is shared with
 * `getSmsThread` and `sendSms`, so the filter stripped every message the user had ever
 * sent out of every CONVERSATION as well — and since replying means the customer wrote
 * first, the peer was always "answered" and not one outbound message survived anywhere.
 * The thread rendered one-sided and a just-sent reply simply never appeared.
 *
 * Operating on built items, applied only by `itemsFor`, is the same split WhatsApp already
 * had and got right: its filter lives in the `getTimeline` query while `getThread` has no
 * direction clause at all.
 *
 * ⚠️ Unlike that WhatsApp twin this is WINDOW-SCOPED and cannot be exact: texts are fetched
 * live from SignalWire per time window, so a conversation whose only inbound message
 * predates the window keeps showing its outbound row. That is a spare row, not a lost
 * message, and it self-corrects the moment the customer replies. Do NOT "fix" it with a
 * per-peer lookup — that is one request per conversation on a route already fanning out six.
 */
export function hideOwnSmsReplies(items: PhoneItemDto[]): PhoneItemDto[] {
  const answeredPeers = new Set<string>();
  for (const item of items) {
    if (item.kind === 'sms' && item.direction === 'inbound') {
      answeredPeers.add(item.counterparty);
    }
  }

  const newestUnanswered = new Map<string, { id: string; at: number }>();
  for (const item of items) {
    if (item.kind !== 'sms' || item.direction !== 'outbound') continue;
    if (answeredPeers.has(item.counterparty)) continue;
    const at = new Date(item.at).getTime();
    if (Number.isNaN(at)) continue;
    const held = newestUnanswered.get(item.counterparty);
    if (!held || at > held.at) {
      newestUnanswered.set(item.counterparty, { id: item.id, at });
    }
  }

  // Calls are untouched: an outgoing call is a row you want, and this rule is about
  // replies inside a conversation.
  return items.filter(
    (item) =>
      item.kind !== 'sms' ||
      item.direction !== 'outbound' ||
      newestUnanswered.get(item.counterparty)?.id === item.id,
  );
}

/**
 * Raw legs → inbox rows, newest first.
 *
 * De-dupes by sid before anything else: a leg where our number is BOTH `to` and
 * `from` would otherwise arrive from two queries and render twice.
 */
export function buildPhoneItems(input: BuildInput): PhoneItemDto[] {
  const {
    now = Date.now(),
    supportNumber,
    calls,
    sipLegs,
    messages,
    recordings,
    readIds,
    completedIds,
    contactNames,
  } = input;
  const minSec = input.minRecordingSec ?? MIN_RECORDING_SECONDS;
  // The same Set this function used to be HANDED, built here instead so the rule that
  // fills it sits beside the rule that reads it. Everything below is unchanged: the
  // own -> parent -> children walk is what finds an outbound call's audio at all, and it
  // took two attempts to get right.
  const recordedCallSids = new Set(
    recordings
      .filter((r) => isAudibleRecording(r, minSec))
      .map((r) => r.callSid)
      .filter((s): s is string => typeof s === 'string'),
  );

  // Several legs can share a parent when a <Dial> rings more than one target; the one
  // that connected is the interesting one, so a connected leg always wins. That rule
  // now lives in `pickConnectedChild` because call control needs the same question
  // answered about LIVE calls — see the warning in its docblock about durationSec being
  // 0 until a call ends. For the finished calls this function sees, it is unchanged.
  const legsByParent = new Map<string, SwCall[]>();
  for (const leg of sipLegs) {
    if (!leg.parentCallSid) continue;
    const group = legsByParent.get(leg.parentCallSid) ?? [];
    group.push(leg);
    legsByParent.set(leg.parentCallSid, group);
  }

  const childByParent = new Map<string, SwCall>();
  const childSidsByParent = new Map<string, string[]>();
  for (const [parentSid, group] of legsByParent) {
    const picked = pickConnectedChild(group);
    if (picked) childByParent.set(parentSid, picked);
    childSidsByParent.set(
      parentSid,
      group.map((leg) => leg.sid),
    );
  }

  /**
   * Does this displayed row have an AUDIBLE recording?
   *
   * `recordedCallSids` holds only recordings that passed `isAudibleRecording`, so a
   * hang-up at the beep is not a recording as far as everything below is concerned —
   * which is what makes `hasRecording` and `hasVoicemail` both go false for one.
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
      now,
    );
    const recorded = hasRecordingFor(call);

    const item: CallItemDto = {
      id,
      sid: call.sid,
      kind: 'call',
      direction: resolved.direction,
      counterparty: resolved.counterparty,
      counterpartyName: contactNames?.get(resolved.counterparty) ?? null,
      supportNumber,
      status: call.status,
      // Kept on the DTO so the detail view knows where to look for the audio when the
      // recording is on the parent leg rather than this one.
      parentCallSid: call.parentCallSid,
      outcome,
      durationSec: call.durationSec,
      hasRecording: recorded,
      // See CallItemDto.hasVoicemail for why this is derivable. `outcome` has already
      // done the hard part by reading the SIP child leg rather than this one, and
      // `isAudibleRecording` has done the rest: a Recording resource exists for a caller
      // who hung up at the beep too, and counting those labelled EVERY missed call a
      // voicemail.
      //
      // INBOUND ONLY, and not merely as a tidy-up: a voicemail is something a CALLER
      // left us. On an outbound leg `record-from-answer-dual` produces nothing when the
      // customer never answers, so in practice this cannot fire -- but the recording
      // lookup also searches the parent SIP leg, which the agent's own browser answered,
      // and one unlucky match there would label a call we placed a message they left.
      hasVoicemail:
        resolved.direction === 'inbound' && outcome === 'missed' && recorded,
      at: new Date(call.startedAt).toISOString(),
      // See `isImplicitlyReadCall`: outbound, and anything somebody actually answered.
      isRead:
        isImplicitlyReadCall(resolved.direction, outcome) || readIds.has(id),
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
      counterpartyName: contactNames?.get(resolved.counterparty) ?? null,
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
