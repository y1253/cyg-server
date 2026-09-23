import { aiAssist, aiTranscribeInbound, visionModel } from './ai.config.js';

describe('aiAssist', () => {
  /**
   * The inversion from `PHONE_RECORD_CALLS` is the whole point: this bills per call AND
   * ships a client's content to OpenAI, so it has to be opted into rather than out of.
   */
  it('is OFF unless the value is exactly "1"', () => {
    expect(aiAssist({})).toBe(false);
    expect(aiAssist({ AI_ASSIST: '' })).toBe(false);
    expect(aiAssist({ AI_ASSIST: '0' })).toBe(false);
    expect(aiAssist({ AI_ASSIST: 'true' })).toBe(false);
    expect(aiAssist({ AI_ASSIST: 'yes' })).toBe(false);
    expect(aiAssist({ AI_ASSIST: '1' })).toBe(true);
    expect(aiAssist({ AI_ASSIST: ' 1 ' })).toBe(true);
  });
});

describe('aiTranscribeInbound', () => {
  /**
   * A SEPARATE flag, because this one stores a verbatim record of a client's spoken words
   * — the decision `CallSummary.transcript` carries its own warning about. The master
   * switch must not turn it on by implication.
   */
  it('is independent of the master switch', () => {
    expect(aiTranscribeInbound({ AI_ASSIST: '1' })).toBe(false);
    expect(aiTranscribeInbound({ AI_TRANSCRIBE_INBOUND: '1' })).toBe(true);
  });
});

describe('visionModel', () => {
  it('falls back through summary, then polish, then a vision-capable default', () => {
    expect(visionModel({})).toBe('gpt-4o-mini');
    expect(visionModel({ OPENAI_POLISH_MODEL: 'p' })).toBe('p');
    expect(
      visionModel({ OPENAI_POLISH_MODEL: 'p', OPENAI_SUMMARY_MODEL: 's' }),
    ).toBe('s');
    expect(
      visionModel({ OPENAI_SUMMARY_MODEL: 's', OPENAI_VISION_MODEL: 'v' }),
    ).toBe('v');
  });

  it('treats a blank value as unset, not as a model named ""', () => {
    expect(visionModel({ OPENAI_VISION_MODEL: '  ' })).toBe('gpt-4o-mini');
  });
});
