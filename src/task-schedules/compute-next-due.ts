export interface ScheduleForDue {
  cycle: number;
  cycleType: string;
  cycleDay: number | null;
  cycleNth: number | null;
}

/**
 * Returns the next due date for a schedule, anchored from `base`.
 *
 * DAYS          → base + cycle days
 * MONTHLY_DATE  → next occurrence of cycleDay (1-31) after base
 * WEEKLY_DAY    → next occurrence of weekday cycleDay (0=Sun…6=Sat) strictly after base
 * MONTHLY_WEEKDAY → cycleNth-th occurrence of weekday cycleDay in the month after base
 */
export function computeNextDue(base: Date, schedule: ScheduleForDue): Date {
  switch (schedule.cycleType) {
    case 'MONTHLY_DATE': {
      const day = schedule.cycleDay ?? 1;
      const today = new Date(base.getFullYear(), base.getMonth(), base.getDate()); // date-only, no time
      const next = new Date(base.getFullYear(), base.getMonth(), day);
      if (next <= today) {
        next.setMonth(next.getMonth() + 1);
      }
      return next;
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
      return new Date(base.getFullYear(), base.getMonth() + 3, day);
    }
    case 'YEARLY': {
      const month = (schedule.cycleNth ?? 1) - 1;
      const day = schedule.cycleDay ?? 1;
      const today = new Date(base.getFullYear(), base.getMonth(), base.getDate());
      const next = new Date(base.getFullYear(), month, day);
      if (next <= today) next.setFullYear(next.getFullYear() + 1);
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
 * DAYS          → startDate itself
 * MONTHLY_DATE  → cycleDay of the same month if >= startDate, otherwise next month
 * WEEKLY_DAY    → startDate if already that weekday, otherwise the next occurrence
 * MONTHLY_WEEKDAY → Nth weekday in the same month if >= startDate, otherwise next month
 */
export function computeFirstDue(startDate: Date, schedule: ScheduleForDue): Date {
  switch (schedule.cycleType) {
    case 'MONTHLY_DATE': {
      const day = schedule.cycleDay ?? 1;
      const candidate = new Date(startDate.getFullYear(), startDate.getMonth(), day);
      if (candidate >= startDate) return candidate;
      return new Date(startDate.getFullYear(), startDate.getMonth() + 1, day);
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
      const firstOfMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const offset = (target - firstOfMonth.getDay() + 7) % 7;
      const candidate = new Date(startDate.getFullYear(), startDate.getMonth(), 1 + offset + (nth - 1) * 7);
      if (candidate >= startDate) return candidate;
      const nextMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
      const nextOffset = (target - nextMonth.getDay() + 7) % 7;
      return new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1 + nextOffset + (nth - 1) * 7);
    }
    default: // DAYS — start date itself is the first due date
      return new Date(startDate);
  }
}
