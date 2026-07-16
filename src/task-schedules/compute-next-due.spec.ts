import {
  computeNextDue,
  computeFirstDue,
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
