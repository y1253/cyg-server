import {
  classifyInboundSms,
  HELP_REPLY,
  OPT_IN_REPLY,
  OPT_OUT_REPLY,
  replyFor,
} from './sms-keywords.util';

describe('classifyInboundSms', () => {
  it('recognises every registered opt-out keyword', () => {
    for (const w of ['STOP', 'UNSUBSCRIBE', 'END', 'QUIT', 'CANCEL']) {
      expect(classifyInboundSms(w)).toBe('stop');
    }
  });

  it('recognises the carrier opt-out words we did not register', () => {
    // Honouring more than we promised is never the failure worth guarding against.
    for (const w of ['STOPALL', 'OPTOUT', 'REVOKE']) {
      expect(classifyInboundSms(w)).toBe('stop');
    }
  });

  it('recognises help and opt-in keywords', () => {
    expect(classifyInboundSms('HELP')).toBe('help');
    expect(classifyInboundSms('INFO')).toBe('help');
    expect(classifyInboundSms('START')).toBe('start');
    expect(classifyInboundSms('YES')).toBe('start');
    expect(classifyInboundSms('UNSTOP')).toBe('start');
  });

  it('ignores case, surrounding whitespace and trailing punctuation', () => {
    expect(classifyInboundSms('  stop  ')).toBe('stop');
    expect(classifyInboundSms('Stop.')).toBe('stop');
    expect(classifyInboundSms('"HELP!"')).toBe('help');
    expect(classifyInboundSms('stop!')).toBe('stop');
  });

  // ── The two false positives that matter ──────────────────────────────────────
  // Both are silent failures: nobody gets an error, the messaging just behaves
  // wrongly and it takes weeks to notice.

  it('does NOT opt out a client who used "stop" inside a sentence', () => {
    // A bookkeeping client writing this must keep receiving messages. Matching a
    // substring would mute them with nothing to indicate it had happened.
    expect(classifyInboundSms('stop by tomorrow at 3')).toBeNull();
    expect(classifyInboundSms('can you stop sending the old form')).toBeNull();
  });

  it('does NOT opt someone back IN from a conversational "yes"', () => {
    // The dangerous direction: this would resume messaging someone who had opted out.
    expect(classifyInboundSms('yes, that works')).toBeNull();
    expect(classifyInboundSms('yes please')).toBeNull();
  });

  it('returns null for ordinary messages, empties and non-strings', () => {
    expect(classifyInboundSms('Here is the bank statement')).toBeNull();
    expect(classifyInboundSms('')).toBeNull();
    expect(classifyInboundSms('   ')).toBeNull();
    expect(classifyInboundSms('...')).toBeNull();
    expect(classifyInboundSms(undefined)).toBeNull();
    expect(classifyInboundSms(null)).toBeNull();
    expect(classifyInboundSms(42)).toBeNull();
  });
});

describe('replyFor', () => {
  it('maps each keyword to its registered reply', () => {
    expect(replyFor('stop')).toBe(OPT_OUT_REPLY);
    expect(replyFor('help')).toBe(HELP_REPLY);
    expect(replyFor('start')).toBe(OPT_IN_REPLY);
  });

  // These are the texts DECLARED on the 10DLC campaign. A carrier audit compares
  // what we send against what was registered, so the required elements are pinned
  // here rather than left to be quietly edited away.
  it('keeps the elements the campaign registration promises', () => {
    expect(HELP_REPLY).toContain('CYG Finance');
    expect(HELP_REPLY).toContain('office@cygfinance.com');
    expect(HELP_REPLY).toContain('855-294-3462');
    expect(HELP_REPLY).toContain('Msg&data rates may apply');
    expect(HELP_REPLY).toContain('STOP');

    expect(OPT_OUT_REPLY).toContain('CYG Finance');
    expect(OPT_OUT_REPLY).toContain('unsubscribed');

    expect(OPT_IN_REPLY).toContain('Msg&data rates may apply');
    expect(OPT_IN_REPLY).toContain('HELP');
  });
});
