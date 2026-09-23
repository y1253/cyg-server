/**
 * The whisper a staff member's own phone hears before it is bridged to a client.
 *
 * Pure — no framework, no network — for the same reason `laml.util.ts` and
 * `phone-message.util.ts` are: this runs inside a webhook on a live call, and a malformed
 * document fails as "this call cannot be completed" with nothing in the log to explain it.
 *
 * ── WHY THE WHISPER EXISTS AT ALL ───────────────────────────────────────────────
 * The ring group dials a personal mobile. If that mobile is off, or the call is declined,
 * the CARRIER's voicemail answers — and an answer is an answer. Without a keypress in
 * between, that leg would join the conference and the customer would be talking to a member
 * of staff's personal voicemail: the company voicemail never runs, the call is filed as
 * answered, and the message is somewhere nobody in this application can ever see it.
 * A voicemail robot does not press 1.
 *
 * ── ESCAPING: PLAIN TEXT OUT ────────────────────────────────────────────────────
 * `whisperText` returns plain text and `sayVerb` escapes it, exactly once, at the `<Say>`
 * boundary — the phone-module convention (`phone-message.util.ts` states it), NOT the
 * inverted one `email-signature` follows. Escaping here as well would turn "O'Brien
 * Bookkeeping" into `O&amp;apos;Brien` and SignalWire would read it out entity by entity.
 */

import {
  gatherVerb,
  hangupVerb,
  pauseVerb,
  response,
  sayVerb,
} from './laml.util.js';

/** The digit that accepts. One key, so `numDigits="1"` returns the instant it is pressed. */
export const ACCEPT_DIGIT = '1';

/**
 * Seconds to wait for the keypress.
 *
 * Long enough for somebody who said "hello?" over the first sentence to hear the second and
 * react; short enough that a carrier voicemail is not recording our prompt for a quarter of
 * a minute. The prompt is said TWICE inside the one `<Gather>` rather than looping, because
 * a second `<Gather>` would be another signed round trip mid-ring for the same words.
 */
export const SCREEN_TIMEOUT_SEC = 8;

/**
 * `+15145550001` -> `5 1 4 5 5 5 0 0 0 1`.
 *
 * Spaced so text-to-speech reads the digits one at a time. Unspaced, every engine tried this
 * as a cardinal number — "five hundred fourteen billion…" — which is unusable for somebody
 * trying to decide whether to take a call.
 *
 * A NANP country code is dropped: "1" on the front of every North American number is noise,
 * and the staff here are in Quebec. Any other country keeps its code, because there the code
 * is the informative part. A number that is not E.164 at all (a withheld caller arrives as
 * an empty string) yields '' and the caller clause is omitted entirely rather than spoken as
 * nothing.
 */
export function spokenDigits(e164: string | null | undefined): string {
  if (!e164) return '';
  const digits = e164.replace(/\D/g, '');
  if (!digits) return '';
  const local =
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.split('').join(' ');
}

export interface WhisperInput {
  /** The company the customer dialled, or null when we could not resolve it. */
  companyName: string | null;
  /** The customer's number, as the webhook reported it. May be '' if withheld. */
  from: string;
  /** Their name from the company's address book, when we have one. */
  fromName: string | null;
}

/**
 * What the staff member hears, as plain text.
 *
 * The DEGRADED form — no company name — is not a failure mode to be avoided so much as one
 * to be survived: the expectation registry is in-process, so a restart mid-ring loses it.
 * The caller's number still comes off the webhook body, so the only thing lost is which
 * client it is about, and the accept still works. That ordering of priorities is the whole
 * design: the whisper must never be the reason a call drops.
 */
export function whisperText(input: WhisperInput): string {
  const caller = input.fromName?.trim() || spokenDigits(input.from);
  const who = caller ? ` from ${caller}` : '';
  const lead = input.companyName
    ? `Call for ${input.companyName}${who}.`
    : `You have a business call${who}.`;
  return `${lead} Press ${ACCEPT_DIGIT} to accept.`;
}

/** The second, shorter pass. Said inside the same `<Gather>`; see SCREEN_TIMEOUT_SEC. */
export function whisperRepeat(): string {
  return `Press ${ACCEPT_DIGIT} to accept.`;
}

/**
 * The whole document the answering mobile runs.
 *
 * ⚠️ `<Hangup/>` sits AFTER the `<Gather>`, and that position is the reject path. `<Gather>`
 * with no input falls through to the next verb, so silence — a carrier voicemail, a pocket,
 * somebody who thought better of it — ends THIS LEG ONLY. The leg never joins the room, so
 * it is not an exit and nothing else is torn down: the browser goes on ringing as its own
 * participant, and an unanswered ring group still reaches the COMPANY's voicemail through
 * `RingGroupService`'s no-answer path.
 *
 * ⚠️ `<Pause length="1"/>` comes FIRST. The human has just said "hello?" and would otherwise
 * talk over the opening words — and the opening words are the ones naming the client.
 */
export function whisperDoc(
  input: WhisperInput & { action: string; voice?: string },
): string {
  const { action, voice } = input;
  return response(
    pauseVerb(1) +
      gatherVerb(
        sayVerb(whisperText(input), { voice }) +
          sayVerb(whisperRepeat(), { voice }),
        {
          // Explicit: see GatherOptions. `dtmf speech` would bill speech recognition per
          // screened call to hear one keypress.
          input: 'dtmf',
          numDigits: 1,
          timeout: SCREEN_TIMEOUT_SEC,
          action,
        },
      ) +
      hangupVerb(),
  );
}
