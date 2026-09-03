import {
  FALLBACK_WEEK,
  HARDCODED_FALLBACK,
  SEED_DEFAULTS,
  SETTINGS_FIELDS,
  parseTime,
  parseWeeklyHours,
  resolveSettings,
  type RawDefaults,
} from './phone-settings.util';

const GLOBAL: RawDefaults = {
  timezone: 'America/Toronto',
  weeklyHours: FALLBACK_WEEK,
  greetingMessage: 'global greeting',
  afterHoursMessage: 'global after hours',
  unavailableMessage: 'global unavailable',
  playGreeting: true,
  afterHoursHangUp: true,
  hoursEnabled: true,
  ringTimeoutSeconds: 30,
  voice: 'alice',
  holdAudioId: 0,
  voicemailEnabled: false,
  voicemailPrompt: 'global voicemail prompt',
  voicemailMaxSeconds: 120,
};

describe('parseTime', () => {
  it('accepts zero-padded 24-hour times', () => {
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('09:05')).toBe(545);
    expect(parseTime('23:59')).toBe(1439);
  });

  it('rejects anything else, without throwing', () => {
    for (const bad of [
      '9:00',
      '25:00',
      '12:60',
      '',
      '  ',
      'noon',
      900,
      null,
      undefined,
      {},
    ]) {
      expect(parseTime(bad)).toBeNull();
    }
  });
});

describe('parseWeeklyHours', () => {
  it('accepts a well-formed week with closed days as null', () => {
    expect(parseWeeklyHours(FALLBACK_WEEK)).toEqual(FALLBACK_WEEK);
  });

  it('returns null — never throws — for every shape of junk', () => {
    const junk = [
      null,
      undefined,
      'monday',
      42,
      {},
      [],
      new Array(6).fill(null), // wrong length
      new Array(8).fill(null), // wrong length
      [...new Array(6).fill(null), { open: '9:00', close: '17:00' }], // bad time
      [...new Array(6).fill(null), { open: '09:00' }], // missing close
      [...new Array(6).fill(null), ['09:00', '17:00']], // array, not object
    ];
    for (const value of junk) {
      expect(() => parseWeeklyHours(value)).not.toThrow();
      expect(parseWeeklyHours(value)).toBeNull();
    }
  });

  it('treats undefined entries as closed, like null', () => {
    const week = parseWeeklyHours(new Array(7).fill(undefined));
    expect(week).toEqual(new Array(7).fill(null));
  });

  it('ignores extra keys on a day rather than rejecting the week', () => {
    const raw = [
      ...new Array(6).fill(null),
      { open: '09:00', close: '17:00', note: 'x' },
    ];
    expect(parseWeeklyHours(raw)?.[6]).toEqual({
      open: '09:00',
      close: '17:00',
    });
  });
});

describe('resolveSettings', () => {
  it('falls back to the global value for every null override', () => {
    const { effective, source } = resolveSettings(GLOBAL, null);
    expect(effective.greetingMessage).toBe('global greeting');
    expect(effective.voice).toBe('alice');
    for (const key of SETTINGS_FIELDS) expect(source[key]).toBe('default');
  });

  it('lets a company override win', () => {
    const { effective, source } = resolveSettings(GLOBAL, {
      greetingMessage: 'company greeting',
    });
    expect(effective.greetingMessage).toBe('company greeting');
    expect(source.greetingMessage).toBe('company');
    // Untouched fields still inherit.
    expect(effective.afterHoursMessage).toBe('global after hours');
    expect(source.afterHoursMessage).toBe('default');
  });

  // ── The `??` vs `||` guard. Each of these three reverts to the global under `||`. ──

  it('treats an overriding FALSE as a value, not an absence', () => {
    const { effective, source } = resolveSettings(GLOBAL, {
      playGreeting: false,
    });
    expect(effective.playGreeting).toBe(false);
    expect(source.playGreeting).toBe('company');
  });

  it('treats an overriding 0 as a value, not an absence', () => {
    const { effective } = resolveSettings(GLOBAL, { ringTimeoutSeconds: 0 });
    expect(effective.ringTimeoutSeconds).toBe(0);
  });

  it('treats an overriding empty string as a value, not an absence', () => {
    // '' means "omit the voice attribute and take the provider default" — a real choice.
    const { effective, source } = resolveSettings(GLOBAL, { voice: '' });
    expect(effective.voice).toBe('');
    expect(source.voice).toBe('company');
  });

  it('reports a source for every field, agreeing with effective', () => {
    const { effective, source } = resolveSettings(GLOBAL, {
      hoursEnabled: false,
      voice: 'polly',
    });
    for (const key of SETTINGS_FIELDS) expect(source[key]).toBeDefined();
    expect(source.hoursEnabled).toBe('company');
    expect(source.voice).toBe('company');
    expect(source.timezone).toBe('default');
    expect(effective.hoursEnabled).toBe(false);
  });

  it('resolves to the hardcoded fallback when there is no global row at all', () => {
    // A database that was never seeded must still answer calls.
    const { effective } = resolveSettings(null, null);
    expect(effective).toEqual(HARDCODED_FALLBACK);
    expect(effective.unavailableMessage).toBe(SEED_DEFAULTS.unavailableMessage);
  });

  describe('weeklyHours cascade', () => {
    const companyWeek = [
      ...new Array(7).fill({ open: '10:00', close: '14:00' }),
    ];

    it('prefers a valid company week', () => {
      const { effective, source } = resolveSettings(GLOBAL, {
        weeklyHours: companyWeek,
      });
      expect(effective.weeklyHours[3]).toEqual({
        open: '10:00',
        close: '14:00',
      });
      expect(source.weeklyHours).toBe('company');
    });

    it('falls back to the global week — reporting source "default" — when the company week is junk', () => {
      const { effective, source } = resolveSettings(GLOBAL, {
        weeklyHours: 'garbage',
      });
      expect(effective.weeklyHours).toEqual(FALLBACK_WEEK);
      expect(source.weeklyHours).toBe('default');
    });

    it('falls back to FALLBACK_WEEK when the GLOBAL week is junk too', () => {
      // One company's bad JSON must not take out the account, and neither must the
      // global row's.
      const { effective } = resolveSettings(
        { ...GLOBAL, weeklyHours: { nope: true } },
        { weeklyHours: null },
      );
      expect(effective.weeklyHours).toEqual(FALLBACK_WEEK);
    });
  });
});

describe('shipped defaults', () => {
  // Voicemail is ON out of the box. It shipped OFF, on the inert-by-default rule
  // hoursEnabled still follows -- but that rule assumes a switch an admin can find, and
  // this one had no UI at all, so "inert" meant every after-hours caller was hung up on
  // with no way to change it. Flipping it back is a product decision, not a refactor,
  // which is why it is pinned here rather than left implicit.
  it('takes messages rather than hanging up', () => {
    expect(SEED_DEFAULTS.voicemailEnabled).toBe(true);
    expect(HARDCODED_FALLBACK.voicemailEnabled).toBe(true);
  });

  // The fallback is what effectiveFor returns when the settings table cannot be read.
  // It must be generous in BOTH directions: ring anyway, and take a message if nobody
  // picks up. A database hiccup must never become a dropped call.
  it('never hangs up on anyone when the settings read fails', () => {
    expect(HARDCODED_FALLBACK.hoursEnabled).toBe(false);
    expect(HARDCODED_FALLBACK.voicemailEnabled).toBe(true);
  });

  it('keeps the message length bounded — <Record> is billed per minute', () => {
    expect(SEED_DEFAULTS.voicemailMaxSeconds).toBeGreaterThan(0);
    expect(SEED_DEFAULTS.voicemailMaxSeconds).toBeLessThanOrEqual(300);
  });
});
