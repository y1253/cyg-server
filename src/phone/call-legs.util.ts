import type { SwCall } from './signalwire-parse.js';
import { LIVE, UNCONNECTED } from './phone-timeline.util.js';
import type { SwParticipant } from './signalwire-parse.js';

/**
 * Which leg is the agent on, and which is the other party?
 *
 * ── WHY THIS IS A MODULE AND NOT AN `if` ──────────────────────────────────────
 * Every call-control operation names a leg, and the answer is INVERTED between inbound
 * and outbound. That inversion has already shipped two bugs in this codebase — first
 * `hasRecording` was false on every outbound call, then `summaryLookupSids` had to be
 * introduced to fix the same mistake a second time. Both were "the call sid" being used
 * without saying WHICH leg.
 *
 *   inbound   the ROOT is the CUSTOMER (`to = +support`), the CHILD is the AGENT.
 *   outbound  the ROOT is the AGENT (`outbound-api`, `to = sip:{shared}@…`), and the
 *             CHILD is the CUSTOMER. Exactly backwards.
 *   internal  the ROOT is the CALLER, the CHILD is the CALLEE — so which one is "the
 *             agent" depends on which of the two is asking.
 *
 * Getting it wrong does not fail loudly: it redirects the wrong person. On a transfer
 * that means handing the agent to themselves and dropping the client.
 */
export type CallKind = 'inbound' | 'outbound' | 'internal';

export interface Legs {
  /** The leg the client holds as `info.callSid`, and the ONLY sid authorization runs on. */
  rootSid: string;
  /**
   * The leg the agent's browser is on, or null if it has not been created yet (the
   * call is still ringing and no child leg exists).
   */
  agentSid: string | null;
  /**
   * The leg the OTHER party is on — the customer, or the colleague on an internal call.
   *
   * This is also the anchor: the leg that must never be left stranded. Every failure
   * path is written to protect it, because dropping the agent is an inconvenience and
   * dropping the client is a lost call.
   */
  peerSid: string | null;
}

export interface LegContext {
  /**
   * Internal calls only: is the person asking the one who PLACED the call?
   *
   * Falls out of `assertParticipant` for free (`row.callerId === userId`), which is why
   * it is a caller-supplied fact rather than something re-derived here.
   */
  requesterIsCaller?: boolean;
}

/**
 * The child leg that actually matters when a `<Dial>` rang several targets.
 *
 * Extracted from `buildPhoneItems`'s `childByParent` loop rather than written a third
 * time. Its rule was "a connected leg always wins", measured by `durationSec > 0`.
 *
 * ⚠️ That measure is useless here, and the reason is easy to miss: **`durationSec` is 0
 * on a call that is still in progress.** `buildPhoneItems` only ever sees finished calls,
 * so the distinction never came up; call control only ever sees LIVE ones, where every
 * leg would look unconnected and the choice would collapse to "whichever came first".
 *
 * So `in-progress` is checked FIRST. On a finished call no leg carries that status, so
 * the rule reduces to exactly the previous behaviour — which is what lets
 * `buildPhoneItems` adopt this function with its tests unchanged.
 */
export function pickConnectedChild(children: SwCall[]): SwCall | null {
  let best: SwCall | null = null;
  for (const leg of children) {
    if (!best) {
      best = leg;
      continue;
    }
    if (best.status === 'in-progress') continue;
    if (leg.status === 'in-progress') {
      best = leg;
      continue;
    }
    if (best.durationSec === 0 && leg.durationSec > 0) best = leg;
  }
  return best;
}

/**
 * The conference room name for a call.
 *
 * Derived from the ROOT sid — a bare UUID — for two reasons:
 *
 *  1. Conference names are ACCOUNT-GLOBAL. A name built from anything less unique (a
 *     company id, a support number) would let two simultaneous calls land in the same
 *     room, bridging two different clients to each other. That is the worst bug this
 *     feature could have.
 *  2. It is DETERMINISTIC, so the room can be recomputed server-side from nothing but
 *     `body.CallSid` on a webhook. That is what makes the `Url=` fallback possible if
 *     inline LaML on `POST /Calls/{sid}` turns out to be unsupported — without it the
 *     room would have to travel as a query parameter, and webhook signatures here are
 *     computed over the exact URL including its query string, which has already cost
 *     this module two deploy cycles.
 */
export function conferenceRoomFor(rootSid: string): string {
  return `cyg-${rootSid}`;
}

/** True when `room` is one of ours, i.e. built by `conferenceRoomFor`. */
export function rootSidFromRoom(room: string): string | null {
  return room.startsWith('cyg-') ? room.slice(4) : null;
}

/**
 * Split a live call into the agent's leg and the other party's.
 *
 * `children` is every leg whose `parentCallSid` is the root. Pass them all; the ring
 * group on an unassigned company produces several and `pickConnectedChild` sorts it out.
 *
 * A null `agentSid`/`peerSid` means that leg does not exist yet, and callers must treat
 * it as "too early", never as "use the root instead" — guessing here is how the wrong
 * person gets redirected.
 */
export function classifyLegs(
  root: SwCall,
  children: SwCall[],
  kind: CallKind,
  ctx: LegContext = {},
): Legs {
  const child = pickConnectedChild(children)?.sid ?? null;

  switch (kind) {
    case 'inbound':
      // The caller reached our support number: they ARE the root leg.
      return { rootSid: root.sid, agentSid: child, peerSid: root.sid };

    case 'outbound':
      // Click-to-call rings the agent's browser first, so the root is OURS and the
      // customer is the child. This is the inversion.
      return { rootSid: root.sid, agentSid: root.sid, peerSid: child };

    case 'internal': {
      // Both legs are the same shared SIP address, so nothing on the legs themselves
      // can tell them apart — only `InternalCall.callerId` can, which is exactly why
      // that row exists.
      const agentIsRoot = ctx.requesterIsCaller === true;
      return {
        rootSid: root.sid,
        agentSid: agentIsRoot ? root.sid : child,
        peerSid: agentIsRoot ? child : root.sid,
      };
    }
  }
}

/**
 * What a blind transfer has come to, from the transferring agent's point of view.
 *
 * There is nothing to observe but the peer leg, so this is a small state machine over it
 * plus its children. Three of the four states are load-bearing and two of them are easy
 * to get wrong.
 */
export type TransferState = 'ringing' | 'answered' | 'no-answer' | 'ended';

/** What `blindTransfer` remembers so the status route can read the legs honestly. */
export interface TransferRecord {
  /** The leg handed over — the customer, or the colleague on an internal call. */
  peerSid: string;
  /**
   * The leg the transferring agent WAS on, and which was hung up.
   *
   * Remembered purely to be EXCLUDED below. On an inbound transfer the peer leg is the
   * root, so its children include this one — and the hangup is best-effort and swallowed
   * (`call-control.service.ts`), so it can still read `in-progress` for a moment or fail
   * to die at all. Without the exclusion the status route reports "they picked up" the
   * instant the transfer starts, closes the card, and takes the take-back with it.
   */
  previousAgentSid: string | null;
  target: { id: number; name: string };
  /** Epoch ms. */
  at: number;
}

/**
 * ⚠️ Deliberately NOT `pickConnectedChild`. That helper answers "which child matters on
 * this call" and will happily return the old, completed agent leg as its best candidate
 * when nothing is live — here that would read as an answered transfer.
 *
 * ⚠️ `'ended'` is NOT the no-answer case. When the colleague does not pick up, the
 * transfer `<Dial action=…>` falls through to `voice/dial-status`, which offers the
 * caller VOICEMAIL — so the peer leg stays `in-progress` while they record a message. A
 * state machine that only knew `ringing | answered | ended` would sit on `'ringing'`
 * forever there, which is precisely the outcome the agent most needs told about.
 */
export function transferStateOf(
  peer: SwCall | null,
  children: SwCall[],
  record: TransferRecord,
): TransferState {
  if (!peer) return 'ended';

  const relevant = children.filter(
    (c) => c.sid !== record.previousAgentSid && c.startedAt >= record.at,
  );

  if (relevant.some((c) => c.status === 'in-progress')) return 'answered';

  // The caller is still on the line but every leg we rang for them is dead: they are in
  // voicemail, or about to be.
  if (
    relevant.length > 0 &&
    relevant.every((c) => UNCONNECTED.has(c.status)) &&
    LIVE.has(peer.status)
  ) {
    return 'no-answer';
  }

  if (!LIVE.has(peer.status)) return 'ended';
  return 'ringing';
}

// ── Add call: several people in one room ─────────────────────────────────────

/**
 * One other person on a conference call, as the SERVER remembers them.
 *
 * ⚠️ `id` exists so that `legSid` never has to leave the server. Every conference
 * operation names a party, and the obvious way to name one is its call sid — but a child
 * leg touches no support number, so `assertCallBelongsTo` would never check it and
 * accepting one would be a "redirect any call on the account" primitive. The client
 * therefore sends `'peer'` or `'p3'`, and only this map turns that into a sid.
 *
 * Ids are handed out monotonically and never reused, so a party leaving cannot hand its
 * id to the next arrival mid-poll.
 */
export interface ConferenceParty {
  id: string;
  legSid: string;
  /** What the agent sees: a contact name, a formatted number, or a colleague's name. */
  label: string;
  kind: 'peer' | 'user' | 'number';
}

/** What `ConferenceService` remembers for one live conference. */
export interface ConferenceRecord {
  room: string;
  kind: CallKind;
  /** The agent's own leg. Never a party — the agent is not somebody they can hold. */
  agentSid: string;
  /**
   * One-shot claim for the dial-status safety net.
   *
   * Set BEFORE awaiting the root's redirect, so the webhook and the explicit redirect
   * cannot both move the same leg. Whichever gets there first wins; the other sees
   * `true` and does nothing.
   */
  rootJoined: boolean;
  /** The leg that IS the root, so `conferenceDoc` knows which document carries `record`. */
  rootSid: string;
  parties: ConferenceParty[];
  companyId: number;
  nextPartyId: number;
  /** Epoch ms. */
  at: number;
}

/** How a party appears to the agent. */
export type PartyState = 'ringing' | 'connected' | 'held' | 'gone';

export interface PartyView {
  id: string;
  label: string;
  state: PartyState;
}

export interface ConferenceView {
  active: boolean;
  parties: PartyView[];
  /** Nobody is held — everybody can hear everybody. */
  merged: boolean;
  canAdd: boolean;
  /** Swap only means something with exactly two other people to swap between. */
  canSwap: boolean;
}

/** Added parties, excluding the original peer. The cap the service enforces. */
export const MAX_ADDED_PARTIES = 4;

/**
 * The conference as the agent should see it.
 *
 * PURE, and the reason is the same one `transferStateOf` gives: this is a state machine,
 * and a state machine that can only be exercised through the provider is a state machine
 * nobody tests. `participants` is the AUTHORITATIVE answer to who is held — the record
 * only carries an optimistic echo of what we last asked for.
 *
 * ⚠️ A party with no participant row is NOT automatically gone. A leg that is still
 * ringing has been created but has not joined, and calling that `gone` would drop the
 * row a fraction of a second after the agent asked for it. `liveLegSids` is what tells
 * the two apart: it holds the sids the caller has confirmed are still live calls.
 */
export function conferenceStateOf(
  participants: SwParticipant[],
  record: ConferenceRecord,
  liveLegSids: ReadonlySet<string>,
): ConferenceView {
  const byLeg = new Map(participants.map((p) => [p.callSid, p]));

  const parties: PartyView[] = record.parties.map((party) => {
    const row = byLeg.get(party.legSid);
    if (row) {
      return {
        id: party.id,
        label: party.label,
        state: row.hold ? 'held' : 'connected',
      };
    }
    return {
      id: party.id,
      label: party.label,
      state: liveLegSids.has(party.legSid) ? 'ringing' : 'gone',
    };
  });

  const present = parties.filter((p) => p.state !== 'gone');

  return {
    // The room is over once the agent is no longer in it, whatever the parties say:
    // the agent joined with endConferenceOnExit, so their absence IS the room ending.
    active: byLeg.has(record.agentSid),
    parties,
    // "Merged" is about who can HEAR each other, so a party still ringing does not
    // spoil it — they are not in the conversation yet either way.
    merged: present.every((p) => p.state !== 'held'),
    canAdd: record.parties.length < MAX_ADDED_PARTIES + 1,
    canSwap: present.length === 2,
  };
}
