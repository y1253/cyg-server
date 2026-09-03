import { webhookBase, webhookUrls } from './phone.config';

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
