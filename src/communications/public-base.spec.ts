import { publicBase, requirePublicBase, signatureImageUrl } from './public-base';

describe('publicBase', () => {
  it('prefers PUBLIC_BASE_URL and strips trailing slashes', () => {
    expect(
      publicBase({ PUBLIC_BASE_URL: 'https://app.cyg.test/', CALLBACK_BASE_URL: 'https://other' }),
    ).toBe('https://app.cyg.test');
  });

  /**
   * The hardening this file exists for: `??` alone returns a declared-but-blank value, and
   * a relative `src` in an email resolves against the recipient's webmail host.
   */
  it('skips a blank value rather than returning it', () => {
    expect(publicBase({ PUBLIC_BASE_URL: '  ', CALLBACK_BASE_URL: 'https://fallback' })).toBe(
      'https://fallback',
    );
  });

  it('guesses localhost when nothing is set — a missing logo, not a failed send', () => {
    expect(publicBase({})).toBe('http://localhost:3000');
    expect(signatureImageUrl({}, 'abc')).toBe(
      'http://localhost:3000/api/signature-images/public/abc',
    );
  });
});

describe('requirePublicBase', () => {
  it('returns the same value as publicBase when one is configured', () => {
    const env = { CALLBACK_BASE_URL: 'https://app.cyg.test/' };
    expect(requirePublicBase(env)).toBe(publicBase(env));
  });

  /**
   * ⚠️ The difference that matters. A localhost `MediaUrl` is accepted by SignalWire and
   * fails at the carrier minutes later, with nothing in the error naming the cause — so
   * this refuses at the point where the mistake is still legible.
   */
  it('throws rather than guessing localhost', () => {
    expect(() => requirePublicBase({})).toThrow(/PUBLIC_BASE_URL/);
    expect(() => requirePublicBase({ PUBLIC_BASE_URL: '   ' })).toThrow(/PUBLIC_BASE_URL/);
  });
});
