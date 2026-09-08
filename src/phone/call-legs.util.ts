import type { SwCall } from './signalwire-parse.js';

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
