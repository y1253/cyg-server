import {
  SHORT_SUMMARY_MAX_CHARS,
  clipToLine,
  parseSummaryReply,
} from './summary-reply.util.js';

/**
 * The parser exists because the reply format has to DEGRADE.
 *
 * By the time it runs, the call has been transcribed AND summarised — both billed — so
 * the cases below are not politeness about model drift. Each one is a way that work gets
 * silently thrown away if the parser is strict, and the brief summary is the half that
 * must survive every time.
 */
describe('parseSummaryReply', () => {
  it('splits a well-formed block into both lengths', () => {
    const { short, brief } = parseSummaryReply(
      'SHORT:\nChased the Q3 filing\nSUMMARY:\nThe client called to ask when ' +
        'the Q3 filing is due. We agreed to send the checklist on Monday.',
    );
    expect(short).toBe('Chased the Q3 filing');
    expect(brief).toBe(
      'The client called to ask when the Q3 filing is due. We agreed to send ' +
        'the checklist on Monday.',
    );
  });

  it('keeps the WHOLE reply as the brief when there is no SHORT label', () => {
    // The expensive failure: a strict parser would return nothing here.
    const raw = 'The client called about payroll. We agreed to call back.';
    const { short, brief } = parseSummaryReply(raw);
    expect(brief).toBe(raw);
    expect(short).toBe('The client called about payroll.');
  });

  it('treats a lone SHORT block as the brief rather than losing it', () => {
    const { short, brief } = parseSummaryReply(
      'SHORT:\nThe client called about payroll and we agreed to call back.',
    );
    expect(brief).toBe(
      'The client called about payroll and we agreed to call back.',
    );
    expect(short).toBe(
      'The client called about payroll and we agreed to call back.',
    );
  });

  it('derives the one-liner when SHORT is present but empty', () => {
    const { short, brief } = parseSummaryReply(
      'SHORT:\n\nSUMMARY:\nPayroll question. Call back Monday.',
    );
    expect(brief).toBe('Payroll question. Call back Monday.');
    expect(short).toBe('Payroll question.');
  });

  it('reads the labels in either order', () => {
    const { short, brief } = parseSummaryReply(
      'SUMMARY:\nA longer account of the call.\nSHORT:\nOne line',
    );
    expect(short).toBe('One line');
    expect(brief).toBe('A longer account of the call.');
  });

  it('accepts the markdown bold a model drifts into', () => {
    const { short, brief } = parseSummaryReply(
      '**Short:**  Chased the filing\n**Summary:** Two sentences here.',
    );
    expect(short).toBe('Chased the filing');
    expect(brief).toBe('Two sentences here.');
  });

  it('never throws on an empty reply', () => {
    expect(parseSummaryReply('')).toEqual({ short: '', brief: '' });
  });

  it('clips an over-long SHORT rather than trusting the instruction', () => {
    const long = 'word '.repeat(60);
    const { short } = parseSummaryReply(`SHORT:\n${long}\nSUMMARY:\nBrief.`);
    expect(short.length).toBeLessThanOrEqual(SHORT_SUMMARY_MAX_CHARS);
    expect(short.endsWith('…')).toBe(true);
  });
});

describe('clipToLine', () => {
  it('leaves a short line alone, with no ellipsis', () => {
    expect(clipToLine('Chased the Q3 filing')).toBe('Chased the Q3 filing');
  });

  it('flattens newlines, because this goes on ONE row', () => {
    expect(clipToLine('two\n  lines')).toBe('two lines');
  });

  it('cuts on a word boundary when one is near the limit', () => {
    expect(clipToLine('alpha bravo charlie delta', 18)).toBe('alpha bravo…');
  });

  it('cuts mid-word rather than throwing most of the line away', () => {
    // One very long token: preferring the boundary would leave almost nothing.
    expect(clipToLine('supercalifragilisticexpialidocious', 12)).toBe(
      'supercalifr…',
    );
  });
});
