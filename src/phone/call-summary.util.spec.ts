import {
  claimableBefore,
  isTranscriptUsable,
  MAX_ATTEMPTS,
  MAX_UPLOAD_BYTES,
  retryDelayMs,
  SUMMARY_STATUS,
  summaryLookupSids,
  toSummaryView,
  TRANSCRIBE_MP3_ARGS,
} from './call-summary.util';

describe('summaryLookupSids — the outbound trap', () => {
  /**
   * The row is keyed by the leg the <Dial> ran on. For an inbound call that is the leg
   * the inbox shows; for click-to-call it is the outbound-api SIP PARENT, while the
   * inbox row is its outbound-dial child. Looking up by the displayed sid alone finds
   * nothing on every outbound call — the same shape as the bug that once made
   * hasRecording false for all of them.
   */
  it('includes the parent, so an outbound call finds its summary', () => {
    expect(summaryLookupSids('child-sid', 'parent-sid')).toEqual([
      'child-sid',
      'parent-sid',
    ]);
  });

  it('is just the sid for an inbound call, which has no parent', () => {
    expect(summaryLookupSids('inbound-sid', null)).toEqual(['inbound-sid']);
    expect(summaryLookupSids('inbound-sid')).toEqual(['inbound-sid']);
  });

  it('does not repeat a sid that is its own parent', () => {
    expect(summaryLookupSids('same', 'same')).toEqual(['same']);
  });
});

describe('toSummaryView — what the client is allowed to see', () => {
  const completedAt = new Date('2026-09-03T12:00:00.000Z');

  it('passes a ready summary through with its timestamp', () => {
    expect(
      toSummaryView({
        status: SUMMARY_STATUS.ready,
        summary: 'Client asked about the Q3 filing.',
        completedAt,
      }),
    ).toEqual({
      status: 'ready',
      summary: 'Client asked about the Q3 filing.',
      reason: null,
      generatedAt: '2026-09-03T12:00:00.000Z',
    });
  });

  it('NEVER carries provider detail into a failed view', () => {
    // The row's lastError can hold an OpenAI message and, on a bad day, a fragment of a
    // request. `toSummaryView` does not take it as an argument at all -- this asserts the
    // shape stays fixed so nobody adds it later "for debugging".
    const view = toSummaryView({
      status: SUMMARY_STATUS.failed,
      summary: null,
      completedAt,
    });
    expect(view.status).toBe('failed');
    expect(view.summary).toBeNull();
    expect(view.reason).toBe('The summary could not be generated.');
    expect(Object.keys(view).sort()).toEqual([
      'generatedAt',
      'reason',
      'status',
      'summary',
    ]);
  });

  it('reports skipped as a plain fact, not an error', () => {
    const view = toSummaryView({
      status: SUMMARY_STATUS.skipped,
      summary: null,
      completedAt,
    });
    expect(view.status).toBe('skipped');
    expect(view.reason).toMatch(/nothing to summarise/i);
  });

  it('gives a pending row no timestamp — nothing has been generated yet', () => {
    expect(
      toSummaryView({
        status: SUMMARY_STATUS.pending,
        summary: null,
        completedAt: null,
      }),
    ).toEqual({
      status: 'pending',
      summary: null,
      reason: null,
      generatedAt: null,
    });
  });

  it('treats an unknown status as pending rather than throwing', () => {
    expect(
      toSummaryView({ status: 'WHAT', summary: null, completedAt: null })
        .status,
    ).toBe('pending');
  });
});

describe('retry backoff', () => {
  it('rises, so a persistent failure stops eating batch slots', () => {
    expect(retryDelayMs(0)).toBeLessThan(retryDelayMs(1));
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(2));
  });

  it('clamps past the end of the ladder rather than going undefined', () => {
    expect(retryDelayMs(MAX_ATTEMPTS + 10)).toBe(retryDelayMs(2));
  });

  it('claimableBefore moves further into the past as attempts rise', () => {
    const now = Date.now();
    expect(claimableBefore(now, 2).getTime()).toBeLessThan(
      claimableBefore(now, 0).getTime(),
    );
  });
});

describe('isTranscriptUsable', () => {
  it('rejects silence — Whisper returns an empty string for it', () => {
    expect(isTranscriptUsable('')).toBe(false);
    expect(isTranscriptUsable('   \n ')).toBe(false);
  });

  it('rejects a fragment of line noise', () => {
    // Summarising this produces a confident sentence about nothing, which is worse than
    // showing no summary at all.
    expect(isTranscriptUsable('uh... hello?')).toBe(false);
  });

  it('accepts a real short call', () => {
    expect(
      isTranscriptUsable('Hi, I am calling about my tax filing deadline.'),
    ).toBe(true);
  });
});

describe('upload constraints', () => {
  it('stays under OpenAI 25 MB cap with room for the multipart envelope', () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(25 * 1024 * 1024);
  });

  it('re-encodes to mono 16 kHz — the rate speech models resample to anyway', () => {
    expect(TRANSCRIBE_MP3_ARGS).toEqual(
      expect.arrayContaining(['-ac', '1', '-ar', '16000']),
    );
  });
});
