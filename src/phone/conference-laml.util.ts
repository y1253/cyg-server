import { recordMode } from './phone.config.js';
import { conferenceVerb, type ConferenceOptions } from './laml.util.js';
import { response } from './laml.util.js';

/**
 * The LaML each participant of an add-call conference is handed.
 *
 * Its own module, with its own spec, because the difference between these three
 * documents is one attribute each and getting one wrong does not fail loudly — it
 * leaves a client talking to a stranger on our bill, or stops a call being recorded, or
 * parks somebody in an empty room. A byte-for-byte spec is the only way that stays true.
 */

/** Who this leg belongs to, which is the only thing that varies. */
export type ConferenceRole = 'agent' | 'party';

export interface ConferenceDocInput {
  room: string;
  role: ConferenceRole;
  /**
   * Is this leg the call's ROOT?
   *
   * ⚠️ This, and NOT the role, is what decides `record`. The recording has always lived
   * on the leg the original `<Dial>` ran on, which is the root: the customer on an
   * inbound call, the agent's own SIP leg on click-to-call. Redirecting a leg drops
   * every attribute its previous `<Dial>` carried, so if the root's new document omits
   * `record` the conversation silently stops being recorded and gets no AI summary.
   *
   * Attaching it by role instead would record the wrong leg on one of the two
   * directions, and produce two files on the other.
   */
  isRoot: boolean;
  /** Where a HELD participant's audio comes from. Omitted → SignalWire's own music. */
  holdUrl?: string;
  /** Conference lifecycle events. Set on the AGENT's document only — see below. */
  statusCallback?: string;
  env?: Record<string, string | undefined>;
}

/**
 * ⚠️ `endConferenceOnExit` is TRUE for the agent and FALSE for everybody else.
 *
 * This is the mobile-phone model, chosen deliberately: when the agent hangs up, the room
 * ends and every other leg runs out of document and hangs up with it. No server call is
 * involved, so it still holds if our process is down.
 *
 * With `false` on the agent, a mis-click would leave a client and an outside third party
 * connected to each other, on our bill, with no UI anywhere able to end it.
 *
 * ⚠️ This CONTRADICTS the aspiration in `ConferenceOptions.endOnExit`'s own docblock,
 * which is written for ATTENDED TRANSFER — a later increment where the agent walks out
 * and leaves the other two talking. That feature will flip this to `false` AND add an
 * explicit "complete transfer" that removes the agent by API. Until it exists, `true` is
 * the correct value here; do not "fix" it back by reading the other docblock alone.
 */
export function conferenceDoc(input: ConferenceDocInput): string {
  const conf: ConferenceOptions = {
    // Nobody waits for an organiser: the agent and the customer are already talking, and
    // a party dialled in should hear the room immediately.
    startOnEnter: true,
    endOnExit: input.role === 'agent',
    // The agent gets no beep — they pressed the button, they know. Everyone else gets
    // one on entry so the people already talking hear that somebody joined, which is
    // both a courtesy and, in several jurisdictions, closer to a consent requirement.
    beep: input.role === 'agent' ? 'false' : 'onEnter',
    ...(input.holdUrl !== undefined && {
      waitUrl: input.holdUrl,
      waitMethod: 'POST' as const,
    }),
    ...(input.statusCallback !== undefined && {
      statusCallback: input.statusCallback,
      statusCallbackEvent: 'start end join leave',
    }),
  };

  // ⚠️ `record` goes on the <Dial>, NEVER on the <Conference> noun. They are different,
  // differently-billed features (see ConferenceOptions' warning), and recording the
  // conference would file the audio against the conference sid rather than a call sid --
  // where `listRecordings({ callSid })` would never find it, and the timeline would
  // silently report "no recording" for exactly the calls that used this feature.
  //
  // ⚠️ No `action`, on any of the three. The conference ending would re-enter
  // `voice/dial-status`, whose first branch joins a conference -- parking the leg in a
  // room that just ended, forever.
  return response(
    conferenceVerb(input.room, conf, {
      ...(input.isRoot && { record: recordMode(input.env ?? process.env) }),
    }),
  );
}
