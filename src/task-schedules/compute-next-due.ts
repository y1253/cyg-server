export interface ScheduleForDue {
  cycle: number;
  cycleType: string;
  cycleDay: number | null;
  cycleNth: number | null;
}

/**
 * `cycleDay === 0` is the "last day of month" sentinel for date-based cycle types
 * (MONTHLY_DATE / QUARTERLY / YEARLY). The day picker offers 1–28 then this sentinel.
 */
export const LAST_DAY_OF_MONTH = 0;

/** Number of days in the given (year, monthIndex 0–11). */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/**
 * Resolves a stored cycleDay to a concrete day-of-month for a given month:
 * - 0 (sentinel) → the month's actual last day
 * - otherwise → clamped to the month's last day (handles legacy 29/30/31 values
 *   gracefully, e.g. 31 → 28/29 in February)
 */
function resolveDay(year: number, monthIndex: number, day: number): number {
  const dim = lastDayOfMonth(year, monthIndex);
  return day === LAST_DAY_OF_MONTH ? dim : Math.min(day, dim);
}

/**
 * Returns the next due date for a schedule, anchored from `base`.
 *
 * DAYS          → base + cycle days
 * MONTHLY_DATE  → next occurrence of cycleDay (1-28, or 0 = last day) after base
 * WEEKLY_DAY    → next occurrence of weekday cycleDay (0=Sun…6=Sat) strictly after base
 * MONTHLY_WEEKDAY → cycleNth-th occurrence of weekday cycleDay in the month after base
 */
export function computeNextDue(base: Date, schedule: ScheduleForDue): Date {
  switch (schedule.cycleType) {
    case 'MONTHLY_DATE': {
      const day = schedule.cycleDay ?? 1;
      const baseDay = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
      );
      const sameMonth = new Date(
        base.getFullYear(),
        base.getMonth(),
        resolveDay(base.getFullYear(), base.getMonth(), day),
      );
      if (sameMonth > baseDay) return sameMonth;
      let m = base.getMonth() + 1;
      let y = base.getFullYear();
      if (m > 11) {
        m = 0;
        y++;
      }
      return new Date(y, m, resolveDay(y, m, day));
    }
    case 'WEEKLY_DAY': {
      const target = schedule.cycleDay ?? 0;
      const next = new Date(base);
      next.setDate(next.getDate() + 1); // strictly after base
      const daysUntil = (target - next.getDay() + 7) % 7;
      next.setDate(next.getDate() + daysUntil);
      return next;
    }
    case 'MONTHLY_WEEKDAY': {
      const target = schedule.cycleDay ?? 0;
      const nth = schedule.cycleNth ?? 1;
      // Always the next calendar month
      const next = new Date(base.getFullYear(), base.getMonth() + 1, 1);
      const firstOccurrence = (target - next.getDay() + 7) % 7;
      next.setDate(1 + firstOccurrence + (nth - 1) * 7);
      return next;
    }
    case 'QUARTERLY': {
      const day = schedule.cycleDay ?? 1;
      let m = base.getMonth() + 3;
      let y = base.getFullYear();
      while (m > 11) {
        m -= 12;
        y++;
      }
      return new Date(y, m, resolveDay(y, m, day));
    }
    case 'YEARLY': {
      const month = (schedule.cycleNth ?? 1) - 1;
      const day = schedule.cycleDay ?? 1;
      const today = new Date(
        base.getFullYear(),
        base.getMonth(),
        base.getDate(),
      );
      let y = base.getFullYear();
      let next = new Date(y, month, resolveDay(y, month, day));
      if (next <= today) {
        y++;
        next = new Date(y, month, resolveDay(y, month, day));
      }
      return next;
    }
    default: {
      const next = new Date(base);
      next.setDate(next.getDate() + schedule.cycle);
      return next;
    }
  }
}

/**
 * Returns the first due date on or after `startDate`, aligned to the schedule's cycle.
 *
 * DAYS          → startDate + cycle days (first occurrence is one cycle after start)
 * MONTHLY_DATE  → cycleDay of the same month if >= startDate, otherwise next month
 * WEEKLY_DAY    → startDate if already that weekday, otherwise the next occurrence
 * MONTHLY_WEEKDAY → Nth weekday in the same month if >= startDate, otherwise next month
 */
export function computeFirstDue(
  startDate: Date,
  schedule: ScheduleForDue,
): Date {
  switch (schedule.cycleType) {
    case 'MONTHLY_DATE': {
      const day = schedule.cycleDay ?? 1;
      const candidate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        resolveDay(startDate.getFullYear(), startDate.getMonth(), day),
      );
      if (candidate >= startDate) return candidate;
      let m = startDate.getMonth() + 1;
      let y = startDate.getFullYear();
      if (m > 11) {
        m = 0;
        y++;
      }
      return new Date(y, m, resolveDay(y, m, day));
    }
    case 'WEEKLY_DAY': {
      const target = schedule.cycleDay ?? 0;
      const daysUntil = (target - startDate.getDay() + 7) % 7;
      const result = new Date(startDate);
      result.setDate(result.getDate() + daysUntil);
      return result;
    }
    case 'MONTHLY_WEEKDAY': {
      const target = schedule.cycleDay ?? 0;
      const nth = schedule.cycleNth ?? 1;
      const firstOfMonth = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1,
      );
      const offset = (target - firstOfMonth.getDay() + 7) % 7;
      const candidate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        1 + offset + (nth - 1) * 7,
      );
      if (candidate >= startDate) return candidate;
      const nextMonth = new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        1,
      );
      const nextOffset = (target - nextMonth.getDay() + 7) % 7;
      return new Date(
        startDate.getFullYear(),
        startDate.getMonth() + 1,
        1 + nextOffset + (nth - 1) * 7,
      );
    }
    case 'QUARTERLY': {
      const day = schedule.cycleDay ?? 1;
      const candidate = new Date(
        startDate.getFullYear(),
        startDate.getMonth(),
        resolveDay(startDate.getFullYear(), startDate.getMonth(), day),
      );
      if (candidate >= startDate) return candidate;
      let m = startDate.getMonth() + 3;
      let y = startDate.getFullYear();
      while (m > 11) {
        m -= 12;
        y++;
      }
      return new Date(y, m, resolveDay(y, m, day));
    }
    case 'YEARLY': {
      const month = (schedule.cycleNth ?? 1) - 1;
      const day = schedule.cycleDay ?? 1;
      const candidate = new Date(
        startDate.getFullYear(),
        month,
        resolveDay(startDate.getFullYear(), month, day),
      );
      if (candidate >= startDate) return candidate;
      const y = startDate.getFullYear() + 1;
      return new Date(y, month, resolveDay(y, month, day));
    }
    default: {
      // DAYS — first due is startDate itself (next occurrences advance by cycle)
      return new Date(startDate);
    }
  }
}
