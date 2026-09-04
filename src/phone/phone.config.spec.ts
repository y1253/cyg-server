import {
  summarizeCalls,
  summaryModel,
  transcribeModel,
  webhookBase,
  webhookUrls,
} from './phone.config';

describe('webhookBase', () => {
  it('prefers PHONE_WEBHOOK_BASE_URL over CALLBACK_BASE_URL', () => {
    expect(
      webhookBase({
        PHONE_WEBHOOK_BASE_URL: 'https://hooks.test',
        CALLBACK_BASE_URL: 'https://cyg.test',
      }),
    ).toBe('https://hooks.test');
  });

  /**
   * The bug this guards against, found by probing a real inbound call locally.
   *
   * `PHONE_WEBHOOK_BASE_URL=` with nothing after it is an empty STRING, not undefined, so
   * `??` returns it — and every callback URL comes out as a bare path like
   * `/api/phone/voice/voicemail`, which SignalWire cannot fetch. Nothing fails loudly:
   * signature verification still passes, because both sides rebuild the URL from this same
   * function. The call simply never reaches us.
   *
   * A blank env var means "not configured"; that is the opposite of the settings tables,
   * where "" is a value an admin deliberately chose.
   */
  it('treats a blank env var as absent, not as a value', () => {
    expect(
      webhookBase({
        PHONE_WEBHOOK_BASE_URL: '',
        CALLBACK_BASE_URL: 'https://cyg.test',
      }),
    ).toBe('https://cyg.test');

    expect(
      webhookBase({
        PHONE_WEBHOOK_BASE_URL: '   ',
        CALLBACK_BASE_URL: 'https://cyg.test',
      }),
    ).toBe('https://cyg.test');
  });

  it('falls back to localhost when neither is set', () => {
    expect(webhookBase({})).toBe('http://localhost:3000');
    expect(
      webhookBase({ PHONE_WEBHOOK_BASE_URL: '', CALLBACK_BASE_URL: '' }),
    ).toBe('http://localhost:3000');
  });

  it('strips trailing slashes', () => {
    expect(webhookBase({ PHONE_WEBHOOK_BASE_URL: 'https://x.test///' })).toBe(
      'https://x.test',
    );
  });
});

describe('webhookUrls', () => {
  const env = { PHONE_WEBHOOK_BASE_URL: 'https://hooks.test' };

  it('builds every callback SignalWire may use', () => {
    expect(webhookUrls(env)).toEqual({
      voiceUrl: 'https://hooks.test/api/phone/voice/inbound',
      smsUrl: 'https://hooks.test/api/phone/sms/inbound',
      statusCallback: 'https://hooks.test/api/phone/voice/status',
      dialStatusUrl: 'https://hooks.test/api/phone/voice/dial-status',
      voicemailUrl: 'https://hooks.test/api/phone/voice/voicemail',
    });
  });

  /**
   * The signature base is the full URL INCLUDING any query string, so a callback whose URL
   * depends on parameter order or encoding is a trap (see phone-dialer.service.ts). Both
   * new routes resolve their company from the POSTed `To` instead.
   */
  it('gives every URL an absolute origin and no query string', () => {
    for (const url of Object.values(webhookUrls(env))) {
      expect(url.startsWith('https://')).toBe(true);
      expect(url).not.toContain('?');
    }
  });
});

describe('summarizeCalls — the flag ships OFF', () => {
  /**
   * ⚠️ The INVERSE of `recordMode`, which is default-ON and disabled by '0'.
   *
   * Recording keeps audio on our own provider account: a storage and consent decision.
   * Summarising bills per minute AND sends a client's recorded conversation to OpenAI.
   * Different risk, different default — and this test is what stops someone "making it
   * consistent" with recordMode by accident.
   */
  it('is OFF when unset', () => {
    expect(summarizeCalls({})).toBe(false);
  });

  it("is OFF for '0', for a blank value, and for anything that is not '1'", () => {
    expect(summarizeCalls({ PHONE_SUMMARIZE_CALLS: '0' })).toBe(false);
    expect(summarizeCalls({ PHONE_SUMMARIZE_CALLS: '' })).toBe(false);
    expect(summarizeCalls({ PHONE_SUMMARIZE_CALLS: 'true' })).toBe(false);
    expect(summarizeCalls({ PHONE_SUMMARIZE_CALLS: 'yes' })).toBe(false);
  });

  it("is ON only for exactly '1'", () => {
    expect(summarizeCalls({ PHONE_SUMMARIZE_CALLS: '1' })).toBe(true);
  });
});

describe('model ids', () => {
  it('defaults the transcription model', () => {
    expect(transcribeModel({})).toBe('whisper-1');
    // A declared-but-blank env var is an empty STRING, not undefined -- the same trap
    // `webhookBaseUrl` was hardened against.
    expect(transcribeModel({ OPENAI_TRANSCRIBE_MODEL: '  ' })).toBe(
      'whisper-1',
    );
  });

  it('honours an override', () => {
    expect(
      transcribeModel({ OPENAI_TRANSCRIBE_MODEL: 'gpt-4o-transcribe' }),
    ).toBe('gpt-4o-transcribe');
  });

  it('falls back to the polish model before the hardcoded default', () => {
    // So an operator who already pinned a chat model does not have to pin it twice.
    expect(summaryModel({ OPENAI_POLISH_MODEL: 'gpt-4o' })).toBe('gpt-4o');
    expect(summaryModel({})).toBe('gpt-4o-mini');
  });

  it('lets the summary model be separated from the polish model', () => {
    expect(
      summaryModel({
        OPENAI_SUMMARY_MODEL: 'gpt-4o',
        OPENAI_POLISH_MODEL: 'mini',
      }),
    ).toBe('gpt-4o');
  });

  it('skips a blank override rather than returning an empty model id', () => {
    expect(
      summaryModel({ OPENAI_SUMMARY_MODEL: '', OPENAI_POLISH_MODEL: 'mini' }),
    ).toBe('mini');
  });
});
