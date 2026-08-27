import {
  computeSignature,
  signatureBase,
  verifySignature,
} from './signature.util';

const TOKEN = 'PT-test-token-not-a-real-secret';
const URL = 'https://internal.cygfinance.com/api/phone/voice/inbound';

/** A realistic inbound-call body, deliberately NOT in sorted key order. */
const PARAMS = {
  To: '+14382561176',
  From: '+15145551234',
  CallSid: 'abc123',
  AccountSid: 'e6627fb0',
  Direction: 'inbound',
};

describe('signatureBase', () => {
  it('sorts by key and concatenates key+value with no separators', () => {
    // The single easiest thing to get wrong. `a=1&b=2` looks right and is wrong;
    // every real request would then fail verification and every call would 403.
    expect(signatureBase('https://x/', { b: '2', a: '1' })).toBe(
      'https://x/a1b2',
    );
  });

  it('is insensitive to the order the params arrived in', () => {
    expect(signatureBase(URL, PARAMS)).toBe(
      signatureBase(URL, {
        Direction: 'inbound',
        AccountSid: 'e6627fb0',
        CallSid: 'abc123',
        From: '+15145551234',
        To: '+14382561176',
      }),
    );
  });

  it('treats a null or undefined value as empty rather than the string "null"', () => {
    expect(signatureBase('u', { a: null, b: undefined })).toBe('uab');
  });

  it('includes the query string as part of the URL', () => {
    expect(signatureBase('https://x/?a=1', {})).toBe('https://x/?a=1');
  });
});

describe('verifySignature', () => {
  it('accepts a correctly signed request', () => {
    const sig = computeSignature(URL, PARAMS, TOKEN);
    expect(verifySignature(sig, URL, PARAMS, TOKEN)).toBe(true);
  });

  it('rejects a tampered param', () => {
    // The attack this exists to stop: rewriting `From` to spoof who is calling.
    const sig = computeSignature(URL, PARAMS, TOKEN);
    const tampered = { ...PARAMS, From: '+15140000000' };
    expect(verifySignature(sig, URL, tampered, TOKEN)).toBe(false);
  });

  it('rejects an added param', () => {
    const sig = computeSignature(URL, PARAMS, TOKEN);
    expect(
      verifySignature(sig, URL, { ...PARAMS, Extra: 'x' }, TOKEN),
    ).toBe(false);
  });

  it('rejects a removed param', () => {
    const sig = computeSignature(URL, PARAMS, TOKEN);
    const { From: _dropped, ...fewer } = PARAMS;
    expect(verifySignature(sig, URL, fewer, TOKEN)).toBe(false);
  });

  it('rejects the right body signed for a different URL', () => {
    // Why the URL must be the configured one, not one rebuilt from the request:
    // behind nginx `req.protocol` is http, and that alone flips this to false.
    const sig = computeSignature(
      'http://internal.cygfinance.com/api/phone/voice/inbound',
      PARAMS,
      TOKEN,
    );
    expect(verifySignature(sig, URL, PARAMS, TOKEN)).toBe(false);
  });

  it('rejects a signature made with a different token', () => {
    const sig = computeSignature(URL, PARAMS, 'some-other-token');
    expect(verifySignature(sig, URL, PARAMS, TOKEN)).toBe(false);
  });

  it.each([
    ['a missing signature', undefined],
    ['an empty signature', ''],
    ['garbage', 'not-base64-at-all'],
    ['a shorter string', 'aGk='],
  ])('returns false for %s rather than throwing', (_label, sig) => {
    expect(() => verifySignature(sig, URL, PARAMS, TOKEN)).not.toThrow();
    expect(verifySignature(sig, URL, PARAMS, TOKEN)).toBe(false);
  });

  it('returns false when the token is not configured', () => {
    // A server missing SIGNALWIRE_API_TOKEN must reject everything, never accept
    // everything — an unset secret is the classic fail-open.
    const sig = computeSignature(URL, PARAMS, TOKEN);
    expect(verifySignature(sig, URL, PARAMS, undefined)).toBe(false);
    expect(verifySignature(sig, URL, PARAMS, '')).toBe(false);
  });

  it('handles an empty body, as a status callback with no params would have', () => {
    const sig = computeSignature(URL, {}, TOKEN);
    expect(verifySignature(sig, URL, {}, TOKEN)).toBe(true);
  });
});
