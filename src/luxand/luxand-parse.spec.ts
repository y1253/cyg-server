import {
  describeLuxandError,
  extractId,
  extractScore,
  failureMessage,
  isFailureEnvelope,
  normalizeScore,
} from './luxand-parse.js';

describe('isFailureEnvelope', () => {
  // The behaviour that motivates this whole module: Luxand answers HTTP 200 for
  // most failures, so res.ok is not an error check.
  it('detects the 200-with-failure envelope', () => {
    expect(
      isFailureEnvelope({ status: 'failure', message: 'No face detected' }),
    ).toBe(true);
  });

  it('does not flag a success envelope', () => {
    expect(isFailureEnvelope({ status: 'success', uuid: 'abc' })).toBe(false);
  });

  it('does not flag an array response', () => {
    // /photo/search answers with a bare [] for no match.
    expect(isFailureEnvelope([])).toBe(false);
  });

  it('does not flag a null body', () => {
    expect(isFailureEnvelope(null)).toBe(false);
  });
});

describe('failureMessage', () => {
  it('prefers the message field', () => {
    expect(failureMessage({ status: 'failure', message: 'boom' }, 'raw')).toBe(
      'boom',
    );
  });

  it('falls back to the raw body when there is no message', () => {
    expect(failureMessage(null, 'not json at all')).toBe('not json at all');
  });
});

describe('extractScore', () => {
  it.each([
    ['probability', { probability: 0.91 }],
    ['confidence', { confidence: 0.91 }],
    ['similarity', { similarity: 0.91 }],
    ['score', { score: 0.91 }],
  ])('accepts %s at the top level', (_name, body) => {
    expect(extractScore(body)).toBe(0.91);
  });

  it('finds a score nested under result', () => {
    expect(
      extractScore({ status: 'success', result: { probability: 0.8 } }),
    ).toBe(0.8);
  });

  it('finds a score nested under data', () => {
    expect(extractScore({ data: { confidence: 0.7 } })).toBe(0.7);
  });

  it('reads the first element of an array response', () => {
    expect(
      extractScore([{ uuid: 'a', probability: 0.66 }, { uuid: 'b' }]),
    ).toBe(0.66);
  });

  it('returns null for an empty array', () => {
    expect(extractScore([])).toBeNull();
  });

  it('returns null when no known key is present', () => {
    // The caller turns this into a loud 502 rather than a silent non-match.
    expect(extractScore({ status: 'success', somethingElse: 1 })).toBeNull();
  });

  it('coerces numeric strings', () => {
    expect(extractScore({ probability: '0.42' })).toBe(0.42);
  });

  it('ignores non-numeric strings', () => {
    expect(extractScore({ probability: 'high' })).toBeNull();
  });

  it('ignores NaN and Infinity', () => {
    expect(extractScore({ probability: Number.NaN })).toBeNull();
    expect(extractScore({ probability: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('accepts a genuine zero score', () => {
    // 0 is a real "no similarity at all" answer, not a missing field.
    expect(extractScore({ probability: 0 })).toBe(0);
  });
});

describe('normalizeScore', () => {
  it('leaves a 0-1 score alone', () => {
    expect(normalizeScore(0.87)).toBeCloseTo(0.87);
  });

  it('rescales a 0-100 score', () => {
    expect(normalizeScore(87)).toBeCloseTo(0.87);
  });

  it('treats exactly 1 as already normalised', () => {
    expect(normalizeScore(1)).toBe(1);
  });

  it('rescales a perfect 100', () => {
    expect(normalizeScore(100)).toBe(1);
  });
});

describe('extractId', () => {
  it('reads uuid', () => {
    expect(extractId({ uuid: 'f47ac10b', name: 'Sarah' })).toBe('f47ac10b');
  });

  it('reads a numeric id as a string', () => {
    // The legacy subject API returns numeric ids.
    expect(extractId({ id: 2868450 })).toBe('2868450');
  });

  it('prefers uuid over id when both are present', () => {
    expect(extractId({ uuid: 'abc', id: 12 })).toBe('abc');
  });

  it('reads the first element of a search array', () => {
    expect(extractId([{ uuid: 'first' }, { uuid: 'second' }])).toBe('first');
  });

  it('finds an id nested under person', () => {
    expect(extractId({ status: 'success', person: { uuid: 'nested' } })).toBe(
      'nested',
    );
  });

  it('returns null for an empty array', () => {
    expect(extractId([])).toBeNull();
  });

  it('returns null when nothing resembles an id', () => {
    expect(extractId({ status: 'success' })).toBeNull();
  });
});

describe('describeLuxandError', () => {
  it.each([
    'No face detected in the photo. Check lighting, avoid backlight and strong shadows.',
    "Can't find faces in attached images",
    'There are some issues with the image',
  ])('passes actionable wording through: %s', (message) => {
    expect(describeLuxandError(message)).toBe(message);
  });

  it('hides anything else behind a generic message', () => {
    expect(describeLuxandError('Internal Server Error')).toBe(
      'Face service error',
    );
  });

  it('does not leak a token or quota message to the user', () => {
    expect(describeLuxandError('Invalid token for account 12345')).toBe(
      'Face service error',
    );
  });
});
