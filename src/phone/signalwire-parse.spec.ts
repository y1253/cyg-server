import {
  areaCodeOf,
  isE164,
  isValidAreaCode,
  parseAvailableNumbers,
  parseOwnedNumbers,
  parsePurchasedNumber,
  signalwireErrorMessage,
  toIsoCountry,
} from './signalwire-parse';

/**
 * A verbatim row from the live search API (captured by scripts/signalwire-probe.mjs).
 * Note the capability casing: `voice` lowercase, `SMS`/`MMS` uppercase. That asymmetry
 * is real, not a typo in this fixture. Note also `iso_country: 'US'` on a Montreal
 * number — that field is wrong at the source, which is why `region` is what we keep.
 */
const LIVE_SEARCH_ROW = {
  friendly_name: '+1 (438) 256-0856',
  phone_number: '+14382560856',
  lata: null,
  locality: null,
  rate_center: 'MONTREAL',
  latitude: null,
  longitude: null,
  region: 'QC',
  postal_code: null,
  iso_country: 'US',
  capabilities: { voice: true, SMS: true, MMS: true },
  beta: false,
};

describe('capability flags are read case-insensitively', () => {
  // The single highest-value test here. Capabilities GATE purchasing: we refuse any
  // number that is not both voice- and SMS-capable. If the casing is read wrongly,
  // every candidate is filtered out and the failure presents as "no numbers available
  // in Canada" — an inventory problem, not the parsing bug it actually is.
  it('reads the live search shape (voice lowercase, SMS/MMS uppercase)', () => {
    const [n] = parseAvailableNumbers({
      available_phone_numbers: [LIVE_SEARCH_ROW],
    });
    expect(n).toMatchObject({ voice: true, sms: true, mms: true });
  });

  it('reads the all-lowercase shape the purchase response uses', () => {
    const n = parsePurchasedNumber({
      sid: 'abc',
      phone_number: '+14382560856',
      capabilities: { voice: true, sms: true, mms: false },
    });
    expect(n).toMatchObject({ voice: true, sms: true, mms: false });
  });

  it('treats a missing or empty capabilities object as no capabilities', () => {
    const [n] = parseAvailableNumbers({
      available_phone_numbers: [
        { phone_number: '+14382560856', capabilities: {} },
      ],
    });
    expect(n).toMatchObject({ voice: false, sms: false, mms: false });
  });

  it('does not treat a truthy non-true value as capable', () => {
    // Guards against a lazy rewrite to a double-bang: only an explicit `true` counts,
    // so a string or a 1 never buys us a number we cannot text from.
    const [n] = parseAvailableNumbers({
      available_phone_numbers: [
        {
          phone_number: '+14382560856',
          capabilities: { voice: 'yes', SMS: 1 },
        },
      ],
    });
    expect(n).toMatchObject({ voice: false, sms: false });
  });
});

/**
 * The two sides read the SAME parser but resolve "not reported" in OPPOSITE directions,
 * and that asymmetry is the fix for a real bug: every purchase was ending in
 * "is not both voice- and SMS-capable" because an absent `capabilities` object read as
 * `false`, so a number we had just paid for was released again.
 */
describe('capabilities are tri-state: true / false / not reported', () => {
  it('reports null, not false, when the purchase response omits capabilities', () => {
    const n = parsePurchasedNumber({ sid: 'abc', phone_number: '+14382560856' });
    expect(n).toMatchObject({ voice: null, sms: null, mms: null });
    expect(n?.capabilitiesRaw).toBeNull();
  });

  it('reports null for a key the purchase response leaves out', () => {
    const n = parsePurchasedNumber({
      sid: 'abc',
      phone_number: '+14382560856',
      capabilities: { voice: true },
    });
    expect(n).toMatchObject({ voice: true, sms: null, mms: null });
  });

  it('reports null rather than coercing a non-boolean value', () => {
    // Neither `true` nor `false` is honest about a shape we have never seen from this
    // API. Coercing either way invents evidence the caller then spends money on.
    const n = parsePurchasedNumber({
      sid: 'abc',
      phone_number: '+14382560856',
      capabilities: { voice: 1, sms: 'true' },
    });
    expect(n).toMatchObject({ voice: null, sms: null });
  });

  it('still reports an explicit false as false', () => {
    // The one signal that legitimately releases a purchased number. Keep it distinct
    // from null or the capability bar stops meaning anything.
    const n = parsePurchasedNumber({
      sid: 'abc',
      phone_number: '+14382560856',
      capabilities: { voice: true, sms: false, mms: false },
    });
    expect(n).toMatchObject({ voice: true, sms: false, mms: false });
  });

  it('echoes the raw capabilities value verbatim for the log', () => {
    const n = parsePurchasedNumber({
      sid: 'abc',
      phone_number: '+14382560856',
      capabilities: { voice: true, SMS: true },
    });
    expect(n?.capabilitiesRaw).toBe('{"voice":true,"SMS":true}');
  });

  it('keeps the SEARCH side fail-closed: unreported never reaches an admin', () => {
    // The opposite default. An unreported flag must not put a number in the picker,
    // or the capability bar leaks numbers that cannot serve as a support line.
    const [n] = parseAvailableNumbers({
      available_phone_numbers: [{ phone_number: '+14382560856' }],
    });
    expect(n).toMatchObject({ voice: false, sms: false, mms: false });
  });
});

describe('toIsoCountry maps Company.country onto a country key', () => {
  // This value decides WHERE we spend money, and the column is a nullable free-text
  // String older than the @IsIn that now guards it. Unknown input must never guess.
  it.each([
    ['USA', 'US'],
    ['CANADA', 'CA'],
    ['usa', 'US'],
    ['Canada', 'CA'],
    ['  CANADA  ', 'CA'],
    ['US', 'US'],
    ['CA', 'CA'],
  ])('%s -> %s', (input, expected) => {
    expect(toIsoCountry(input)).toBe(expected);
  });

  it.each([['MEXICO'], ['FRANCE'], [''], ['   ']])(
    '%s -> null (skip, never guess)',
    (input) => {
      expect(toIsoCountry(input)).toBeNull();
    },
  );

  it('returns null for null and undefined', () => {
    expect(toIsoCountry(null)).toBeNull();
    expect(toIsoCountry(undefined)).toBeNull();
  });
});

describe('NANP validation', () => {
  it.each([['514'], ['438'], ['212'], ['999']])(
    '%s is a valid area code',
    (v) => {
      expect(isValidAreaCode(v)).toBe(true);
    },
  );

  it.each([
    ['051'], // NANP area codes never start with 0
    ['151'], // ...nor with 1
    ['5141'], // too long
    ['51'], // too short
    ['abc'],
    [''],
  ])('%s is rejected as an area code', (v) => {
    expect(isValidAreaCode(v)).toBe(false);
  });

  it.each([['+14382560856'], ['+15145551234'], ['+442071838750']])(
    '%s is E.164',
    (v) => {
      expect(isE164(v)).toBe(true);
    },
  );

  it.each([
    ['14382560856'], // no leading +
    ['+0438256085'], // country code cannot start with 0
    ['+1438'], // too short
    ['(438) 256-0856'],
    [''],
  ])('%s is not E.164', (v) => {
    expect(isE164(v)).toBe(false);
  });

  it('extracts the area code from a NANP number', () => {
    expect(areaCodeOf('+14382560856')).toBe('438');
  });

  it.each([['+442071838750'], ['+1438'], ['not a number']])(
    'returns null for %s',
    (v) => {
      expect(areaCodeOf(v)).toBeNull();
    },
  );
});

describe('parseAvailableNumbers never throws and never returns a partial row', () => {
  it('maps the live payload', () => {
    expect(
      parseAvailableNumbers({ available_phone_numbers: [LIVE_SEARCH_ROW] }),
    ).toEqual([
      {
        phoneNumber: '+14382560856',
        friendlyName: '+1 (438) 256-0856',
        region: 'QC',
        rateCenter: 'MONTREAL',
        locality: null,
        voice: true,
        sms: true,
        mms: true,
      },
    ]);
  });

  it.each([
    ['an empty list', { available_phone_numbers: [] }],
    ['a missing key', { uri: '/x' }],
    ['a non-array value', { available_phone_numbers: 'nope' }],
    ['null', null],
    ['an array body', []],
  ])('returns [] for %s', (_label, body) => {
    expect(parseAvailableNumbers(body as never)).toEqual([]);
  });

  it('drops rows whose phone_number is missing or not E.164', () => {
    // The phone number is what the next call spends money on, so a row without a
    // usable one is discarded rather than passed along half-formed.
    expect(
      parseAvailableNumbers({
        available_phone_numbers: [
          { phone_number: null },
          { phone_number: '438-256-0856' },
          null,
          'garbage',
          LIVE_SEARCH_ROW,
        ],
      }),
    ).toHaveLength(1);
  });
});

describe('parsePurchasedNumber', () => {
  it('maps a purchase response', () => {
    expect(
      parsePurchasedNumber({
        sid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        phone_number: '+14382560856',
        friendly_name: 'Acme Bookkeeping',
        voice_url: 'https://x/api/phone/voice/inbound',
        sms_url: 'https://x/api/phone/sms/inbound',
        capabilities: { voice: true, SMS: true, MMS: false },
      }),
    ).toEqual({
      sid: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      phoneNumber: '+14382560856',
      friendlyName: 'Acme Bookkeeping',
      voiceUrl: 'https://x/api/phone/voice/inbound',
      smsUrl: 'https://x/api/phone/sms/inbound',
      voice: true,
      sms: true,
      mms: false,
      capabilitiesRaw: '{"voice":true,"SMS":true,"MMS":false}',
    });
  });

  it.each([
    ['a missing sid', { phone_number: '+14382560856' }],
    ['a missing phone_number', { sid: 'abc' }],
    ['null', null],
    ['an array', []],
  ])('returns null for %s, so the caller releases', (_label, body) => {
    expect(parsePurchasedNumber(body as never)).toBeNull();
  });

  it('parses the owned-numbers list, skipping unusable rows', () => {
    expect(
      parseOwnedNumbers({
        incoming_phone_numbers: [
          { sid: 'a', phone_number: '+14382560856' },
          { sid: 'b' },
        ],
      }),
    ).toHaveLength(1);
  });

  it('returns [] when the owned list is empty or absent', () => {
    expect(parseOwnedNumbers({ incoming_phone_numbers: [] })).toEqual([]);
    expect(parseOwnedNumbers({})).toEqual([]);
  });
});

describe('signalwireErrorMessage', () => {
  it('prefers the structured message and includes the code', () => {
    expect(
      signalwireErrorMessage(
        { code: 21422, message: 'Phone number is not available' },
        'raw',
      ),
    ).toBe('Phone number is not available (code 21422)');
  });

  it('falls back to the raw body when there is no structured message', () => {
    expect(signalwireErrorMessage(null, '<html>502 Bad Gateway</html>')).toBe(
      '<html>502 Bad Gateway</html>',
    );
  });

  it('truncates a huge raw body so an HTML page cannot flood the logs', () => {
    expect(signalwireErrorMessage(null, 'x'.repeat(5000))).toHaveLength(300);
  });

  it('names an empty body rather than returning an empty string', () => {
    expect(signalwireErrorMessage(null, '')).toBe('empty response body');
  });
});
