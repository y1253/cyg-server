import type { WeeklyHours } from './phone-settings.util';
import {
  describeToday,
  isOpenAt,
  isValidTimeZone,
  zonedNow,
} from './phone-hours.util';

const TZ = 'America/Toronto';

/** A week where only the named weekday is open, so a test can isolate one rule. */
function weekWith(day: number, open: string, close: string): WeeklyHours {
  const week: WeeklyHours = new Array(7).fill(null);
  week[day] = { open, close };
  return week;
}

const NINE_TO_FIVE: WeeklyHours = [
  null,
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  { open: '09:00', close: '17:00' },
  null,
];

describe('zonedNow', () => {
  it('reads the wall clock in the target zone, not the server zone', () => {
    // 15:30 UTC is 10:30 in Toronto during EST.
    expect(zonedNow(new Date('2026-01-15T15:30:00Z'), TZ)).toEqual({
      weekday: 4, // Thursday
      minutes: 10 * 60 + 30,
    });
  });

  it('handles DST with no date arithmetic — the same UTC offset shift is ICU’s job', () => {
    // The SAME 15:30 UTC is 11:30 in Toronto during EDT: one hour later than in January.
    expect(zonedNow(new Date('2026-07-15T15:30:00Z'), TZ)).toEqual({
      weekday: 3, // Wednesday
      minutes: 11 * 60 + 30,
    });
  });

  it('normalises midnight to 0 minutes, not 1440', () => {
    // `hour12: false` reports midnight as "24" on several ICU builds. Without `hour % 24`
    // this returns 1440 and every company is silently open at 00:00.
    expect(zonedNow(new Date('2026-01-15T05:00:00Z'), TZ)).toEqual({
      weekday: 4,
      minutes: 0,
    });
  });

  it('falls back to UTC instead of throwing on an invalid timezone', () => {
    // A typo in the database must not 500 a live webhook.
    expect(() => zonedNow(new Date('2026-01-15T15:30:00Z'), 'Mars/Olympus')).not.toThrow();
    expect(zonedNow(new Date('2026-01-15T15:30:00Z'), 'Mars/Olympus')).toEqual({
      weekday: 4,
      minutes: 15 * 60 + 30,
    });
  });

  it('reads a wildly different zone correctly', () => {
    // Thursday 15:30 UTC is already Friday 02:30 in Sydney.
    expect(zonedNow(new Date('2026-01-15T15:30:00Z'), 'Australia/Sydney')).toEqual({
      weekday: 5,
      minutes: 2 * 60 + 30,
    });
  });
});

describe('isValidTimeZone', () => {
  it('accepts real IANA ids and rejects everything else', () => {
    expect(isValidTimeZone('America/Toronto')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone('   ')).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe('isOpenAt — the ordinary same-day window', () => {
  // Thursday in Toronto, EST. 14:00 UTC = 09:00 local (the open minute).
  const at = (localHHmm: string) => {
    const [h, m] = localHHmm.split(':').map(Number);
    const utcHour = h + 5; // EST is UTC-5
    return new Date(
      `2026-01-15T${String(utcHour).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`,
    );
  };

  it('is open in the middle of the window', () => {
    expect(isOpenAt(NINE_TO_FIVE, TZ, at('12:00'))).toBe(true);
  });

  it('is open AT the opening minute', () => {
    expect(isOpenAt(NINE_TO_FIVE, TZ, at('09:00'))).toBe(true);
  });

  it('is CLOSED at the closing minute — the window is half-open', () => {
    // "We close at five" means five o'clock is closed. The alternative has 17:00:30
    // still answering.
    expect(isOpenAt(NINE_TO_FIVE, TZ, at('17:00'))).toBe(false);
  });

  it('is open one minute before closing', () => {
    expect(isOpenAt(NINE_TO_FIVE, TZ, at('16:59'))).toBe(true);
  });

  it('is closed before opening', () => {
    expect(isOpenAt(NINE_TO_FIVE, TZ, at('08:59'))).toBe(false);
  });

  it('is closed on a null day', () => {
    // 2026-01-17 is a Saturday, which NINE_TO_FIVE marks closed.
    expect(isOpenAt(NINE_TO_FIVE, TZ, new Date('2026-01-17T17:00:00Z'))).toBe(false);
  });

  it('treats open === close as closed, not as 24 hours', () => {
    // 24h is written 00:00-23:59. A zero-length window is a mistake, and it fails closed.
    expect(isOpenAt(weekWith(4, '09:00', '09:00'), TZ, at('12:00'))).toBe(false);
  });

  it('fails CLOSED on a malformed time rather than ringing someone at 3am', () => {
    for (const bad of [
      weekWith(4, '9:00', '17:00'),
      weekWith(4, '09:00', '25:00'),
      weekWith(4, '', '17:00'),
    ]) {
      expect(isOpenAt(bad, TZ, at('12:00'))).toBe(false);
    }
  });
});

describe('isOpenAt — overnight windows', () => {
  // Friday 22:00 - 02:00, in Toronto (EDT in September).
  const week = weekWith(5, '22:00', '02:00');

  it('is open on Friday evening, after the opening time', () => {
    expect(isOpenAt(week, TZ, new Date('2026-09-05T03:00:00Z'))).toBe(true); // Fri 23:00
  });

  it('is open on SATURDAY morning — the window spills past midnight', () => {
    expect(isOpenAt(week, TZ, new Date('2026-09-05T05:00:00Z'))).toBe(true); // Sat 01:00
  });

  it('is CLOSED on Friday morning — Friday 1am belongs to Thursday night', () => {
    // The case a naive same-day check gets wrong: it would see Friday's 22:00-02:00 row,
    // notice 01:00 < 02:00, and wrongly answer.
    expect(isOpenAt(week, TZ, new Date('2026-09-04T05:00:00Z'))).toBe(false); // Fri 01:00
  });

  it('is closed on Saturday once the spill has ended', () => {
    expect(isOpenAt(week, TZ, new Date('2026-09-05T07:00:00Z'))).toBe(false); // Sat 03:00
  });

  it('spills across the WEEK boundary, from Saturday into Sunday', () => {
    // Index arithmetic: Sunday (0) looks back at (0 + 6) % 7 = Saturday (6).
    const satNight = weekWith(6, '22:00', '02:00');
    expect(isOpenAt(satNight, TZ, new Date('2026-09-06T05:00:00Z'))).toBe(true); // Sun 01:00
  });
});

describe('isOpenAt — DST transition days', () => {
  // Pinned so nobody "fixes" the wall-clock comparison into date arithmetic. Both of
  // these are correct-by-construction consequences of comparing local wall-clock time.

  it('spring forward: 02:00-03:00 does not exist, so a company open then is closed', () => {
    // 2026-03-08 in Toronto jumps 02:00 -> 03:00. 07:30 UTC is 03:30 local.
    const week = weekWith(0, '02:00', '02:30');
    expect(() => isOpenAt(week, TZ, new Date('2026-03-08T07:30:00Z'))).not.toThrow();
    expect(isOpenAt(week, TZ, new Date('2026-03-08T07:30:00Z'))).toBe(false);
  });

  it('fall back: 01:00-02:00 happens twice, so the window is open for two real hours', () => {
    // 2026-11-01 in Toronto repeats 01:00-02:00. 05:30 UTC is the first pass at 01:30.
    const week = weekWith(0, '01:00', '01:45');
    expect(isOpenAt(week, TZ, new Date('2026-11-01T05:30:00Z'))).toBe(true);
    // ...and again an hour of real time later, at the second 01:30.
    expect(isOpenAt(week, TZ, new Date('2026-11-01T06:30:00Z'))).toBe(true);
  });
});

describe('describeToday', () => {
  const thursdayNoon = new Date('2026-01-15T17:00:00Z');

  it('speaks a whole-hour window without a leading zero', () => {
    expect(describeToday(NINE_TO_FIVE, TZ, thursdayNoon)).toBe('9 AM to 5 PM');
  });

  it('includes minutes when there are any', () => {
    expect(describeToday(weekWith(4, '08:30', '17:15'), TZ, thursdayNoon)).toBe(
      '8:30 AM to 5:15 PM',
    );
  });

  it('says "closed today" for a null day, a zero-length window and a malformed time', () => {
    expect(describeToday(new Array(7).fill(null), TZ, thursdayNoon)).toBe('closed today');
    expect(describeToday(weekWith(4, '09:00', '09:00'), TZ, thursdayNoon)).toBe('closed today');
    expect(describeToday(weekWith(4, '9:00', '17:00'), TZ, thursdayNoon)).toBe('closed today');
  });

  it('reads noon and midnight as 12, not 0', () => {
    expect(describeToday(weekWith(4, '00:00', '12:00'), TZ, thursdayNoon)).toBe(
      '12 AM to 12 PM',
    );
  });
});
