import {
  aiAssist,
  aiDictationLive,
  aiTranscribeInbound,
  dictationModel,
  visionModel,
} from './ai.config.js';

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

describe('dictationModel', () => {
  /**
   * The reported bug in one assertion: with nothing configured, dictation must NOT land
   * on `whisper-1`, whose captioned-video training is what answered "hi what's doing"
   * with "Thank you for watching."
   */
  it('defaults to gpt-4o-mini-transcribe, not whisper-1', () => {
    expect(dictationModel({})).toBe('gpt-4o-mini-transcribe');
  });

  it('honours an explicit dictation pin above everything', () => {
    expect(
      dictationModel({
        OPENAI_DICTATION_MODEL: 'd',
        OPENAI_TRANSCRIBE_MODEL: 't',
      }),
    ).toBe('d');
  });

  /**
   * An operator who has already pinned the transcription model keeps their pin here —
   * the `visionModel` ladder, for the same reason: nobody should have to name the same
   * model twice.
   */
  it('falls back to the shared transcribe pin', () => {
    expect(dictationModel({ OPENAI_TRANSCRIBE_MODEL: 'whisper-1' })).toBe(
      'whisper-1',
    );
  });

  it('treats a blank value as unset, not as a model named ""', () => {
    expect(
      dictationModel({
        OPENAI_DICTATION_MODEL: '  ',
        OPENAI_TRANSCRIBE_MODEL: '',
      }),
    ).toBe('gpt-4o-mini-transcribe');
  });
});

describe('aiDictationLive', () => {
  /**
   * `aiTranscribeInbound`'s polarity rather than `PHONE_RING_MOBILES`'s: the live preview
   * is the Web Speech API, which in Chrome sends the microphone to GOOGLE. Consenting to
   * OpenAI via `AI_ASSIST` must not imply consenting to a second, different third party.
   */
  it('is OFF unless the value is exactly "1"', () => {
    expect(aiDictationLive({})).toBe(false);
    expect(aiDictationLive({ AI_DICTATION_LIVE: '' })).toBe(false);
    expect(aiDictationLive({ AI_DICTATION_LIVE: '0' })).toBe(false);
    expect(aiDictationLive({ AI_DICTATION_LIVE: 'true' })).toBe(false);
    expect(aiDictationLive({ AI_DICTATION_LIVE: '1' })).toBe(true);
    expect(aiDictationLive({ AI_DICTATION_LIVE: ' 1 ' })).toBe(true);
  });

  it('is independent of AI_ASSIST', () => {
    expect(aiDictationLive({ AI_ASSIST: '1' })).toBe(false);
  });
});
