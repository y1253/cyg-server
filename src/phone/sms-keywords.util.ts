/**
 * The consumer keyword rules for inbound SMS: STOP, HELP and START.
 *
 * Nothing in the platform does this for us. SignalWire — unlike Twilio, whose Advanced
 * Opt-Out is on by default — documents keyword handling as the sender's responsibility,
 * and there is no network-level HELP responder anywhere: CTIA requires the SENDER to
 * answer HELP, and to answer it whether or not the person is subscribed.
 *
 * US carriers do block a number that keeps messaging someone who sent STOP, so the
 * recipient is protected on that route even with no code here. That protection is not a
 * substitute for this file — it works by recording an opt-out VIOLATION against the
 * campaign every time we try, which is the path to a suspension.
 *
 * ⚠️ The three reply texts below are the ones DECLARED on the 10DLC campaign. They are
 * what a reviewer or a carrier audit compares against. Change them here and change them
 * in the campaign registration, or the two disagree.
 */

export type SmsKeyword = 'stop' | 'help' | 'start';

/** Registered as the campaign's opt-out keywords. */
const STOP_WORDS = new Set([
  'STOP',
  'UNSUBSCRIBE',
  'END',
  'QUIT',
  'CANCEL',
  // Not registered, but carriers treat these as opt-out and honouring more than we
  // promised is never the failure mode worth guarding against.
  'STOPALL',
  'OPTOUT',
  'REVOKE',
]);

/** Registered as the campaign's help keywords. */
const HELP_WORDS = new Set(['HELP', 'INFO']);

/** Registered as the campaign's opt-in keywords. */
const START_WORDS = new Set(['START', 'YES', 'UNSTOP']);

export const OPT_OUT_REPLY =
  'CYG Finance: You have been unsubscribed and will receive no further text messages ' +
  'from us. For help, email office@cygfinance.com or call 855-294-3462.';

export const HELP_REPLY =
  'CYG Finance bookkeeping account messages. For help, email office@cygfinance.com or ' +
  'call 855-294-3462. Msg&data rates may apply. Reply STOP to unsubscribe.';

export const OPT_IN_REPLY =
  'CYG Finance: You are now subscribed to bookkeeping account messages. Msg frequency ' +
  'varies. Msg&data rates may apply. Reply HELP for help, STOP to unsubscribe.';

/**
 * Classify an inbound message body.
 *
 * ⚠️ The match is on the WHOLE message, not on a word inside it, and that is deliberate
 * in both directions. A client writing "stop by tomorrow at 3" must not be silently
 * opted out — the messaging just goes quiet and nobody finds out for weeks. And a client
 * answering "yes, that works" must not be opted back IN, which would be us resuming
 * messages to someone who had opted out. Exact match is also what carriers themselves
 * do, so being cleverer here would put us out of step with the enforcement.
 *
 * Case, surrounding whitespace and trailing punctuation are ignored, because "Stop."
 * is unambiguously the keyword.
 */
export function classifyInboundSms(body: unknown): SmsKeyword | null {
  if (typeof body !== 'string') return null;

  const word = body
    .trim()
    // Strip punctuation and quotes from both ends. A message that is only punctuation
    // collapses to '', which matches nothing.
    .replace(/^[\s"'“”‘’.,!?-]+/u, '')
    .replace(/[\s"'“”‘’.,!?-]+$/u, '')
    .toUpperCase();

  if (!word) return null;
  if (STOP_WORDS.has(word)) return 'stop';
  if (HELP_WORDS.has(word)) return 'help';
  if (START_WORDS.has(word)) return 'start';
  return null;
}

/** The reply a given keyword must be answered with. */
export function replyFor(keyword: SmsKeyword): string {
  switch (keyword) {
    case 'stop':
      return OPT_OUT_REPLY;
    case 'help':
      return HELP_REPLY;
    case 'start':
      return OPT_IN_REPLY;
  }
}
