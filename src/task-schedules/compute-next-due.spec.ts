import {
  computeNextDue,
  computeFirstDue,
  parseDateOnly,
  ScheduleForDue,
} from './compute-next-due';

const isMidnight = (d: Date) =>
  d.getHours() === 0 &&
  d.getMinutes() === 0 &&
  d.getSeconds() === 0 &&
  d.getMilliseconds() === 0;

const CASES: Array<[string, ScheduleForDue]> = [
  ['DAYS', { cycleType: 'DAYS', cycle: 3, cycleDay: null, cycleNth: null }],
  [
    'WEEKLY_DAY',
    { cycleType: 'WEEKLY_DAY', cycle: 0, cycleDay: 2, cycleNth: null },
  ],
  [
    'MONTHLY_DATE',
    { cycleType: 'MONTHLY_DATE', cycle: 0, cycleDay: 15, cycleNth: null },
  ],
  [
    'MONTHLY_DATE last-day',
    { cycleType: 'MONTHLY_DATE', cycle: 0, cycleDay: 0, cycleNth: null },
  ],
  [
    'QUARTERLY',
    { cycleType: 'QUARTERLY', cycle: 0, cycleDay: 0, cycleNth: null },
  ],
  ['YEARLY', { cycleType: 'YEARLY', cycle: 0, cycleDay: 10, cycleNth: 6 }],
  [
    'MONTHLY_WEEKDAY',
    { cycleType: 'MONTHLY_WEEKDAY', cycle: 0, cycleDay: 1, cycleNth: 2 },
  ],
];

describe('compute-next-due — due dates are always midnight (date-only)', () => {
  // A base carrying a mid-day time must never leak time-of-day into the result,
  // otherwise DAYS/WEEKLY_DAY chains propagate it and todos flip at the wrong hour.
  const midDayBase = new Date(2026, 6, 15, 14, 32, 17, 500); // Jul 15 2026 14:32

  it.each(CASES)(
    'computeNextDue(%s) returns midnight from a mid-day base',
    (_, schedule) => {
      expect(isMidnight(computeNextDue(midDayBase, schedule))).toBe(true);
    },
  );

  it.each(CASES)(
    'computeFirstDue(%s) returns midnight from a mid-day base',
    (_, schedule) => {
      expect(isMidnight(computeFirstDue(midDayBase, schedule))).toBe(true);
    },
  );

  it('DAYS advances by the cycle length', () => {
    const next = computeNextDue(midDayBase, {
      cycleType: 'DAYS',
      cycle: 3,
      cycleDay: null,
      cycleNth: null,
    });
    expect(next).toEqual(new Date(2026, 6, 18)); // Jul 18, midnight
  });
});

describe('parseDateOnly — date-only strings anchor to the local day', () => {
  // `new Date('2026-07-13')` is UTC midnight, which is Jul 12 in any negative
  // offset timezone. Asserted with local getters so this passes in every zone.
  it('keeps the calendar day of a bare yyyy-mm-dd string', () => {
    const d = parseDateOnly('2026-07-13');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 13]);
    expect(isMidnight(d)).toBe(true);
  });

  it('takes the UTC calendar day of a full ISO string', () => {
    const d = parseDateOnly('2026-07-13T00:00:00.000Z');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 13]);
  });

  it('strips time from a Date', () => {
    const d = parseDateOnly(new Date(2026, 6, 13, 18, 45));
    expect(d).toEqual(new Date(2026, 6, 13));
  });
});

describe('DAYS — first todo lands on the start day', () => {
  const weekly: ScheduleForDue = {
    cycleType: 'DAYS',
    cycle: 7,
    cycleDay: null,
    cycleNth: null,
  };

  it('computeFirstDue returns the start date itself', () => {
    expect(computeFirstDue(parseDateOnly('2026-07-13'), weekly)).toEqual(
      new Date(2026, 6, 13),
    );
  });

  it('produces Jul 13 → Jul 20 → Jul 27, never Jul 19', () => {
    const first = computeFirstDue(parseDateOnly('2026-07-13'), weekly);
    const second = computeNextDue(first, weekly);
    const third = computeNextDue(second, weekly);
    expect([first, second, third]).toEqual([
      new Date(2026, 6, 13),
      new Date(2026, 6, 20),
      new Date(2026, 6, 27),
    ]);
  });
});
