/**
 * "Is this company open right now?" — the rule that decides whether an inbound call rings
 * a phone or hears the after-hours message.
 *
 * Pure and no dependency: `Intl.DateTimeFormat` with a `timeZone` is the whole timezone
 * story, because we never do date ARITHMETIC. We ask ICU for the wall-clock weekday and
 * hour:minute in the configured zone and compare minute-of-day. There is no "add 24
 * hours" anywhere, so DST is ICU's problem rather than ours.
 */

import type { WeeklyHours } from './phone-settings.util.js';
import { parseTime } from './phone-settings.util.js';

/**
 * `weekday: 'short'` returns LOCALE TEXT, so it is mapped through an explicit table
 * against a pinned `'en-US'`. Never `new Date(formattedString)` — that reparses a
 * localised string in the server's own zone and is wrong twice over.
 */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Formatters are expensive to construct and are reused across calls. */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  formatterCache.set(timeZone, fmt);
  return fmt;
}

export interface ZonedNow {
  /** 0 = Sunday … 6 = Saturday, matching `WeeklyHours`. */
  weekday: number;
  /** Minutes since local midnight, 0–1439. */
  minutes: number;
}

/**
 * The wall-clock weekday and minute-of-day at `at`, in `timeZone`.
 *
 * Two things here look like paranoia and are not:
 *
 *  - **`hour12: false` reports midnight as `"24"`** in several ICU versions rather than
 *    `"00"`. Uncaught, `% 60` arithmetic puts midnight at 1440 minutes and a company is
 *    silently "open" at 00:00. Hence `hour % 24`.
 *  - **An invalid `timeZone` throws `RangeError` from the CONSTRUCTOR**, not at format
 *    time. A typo'd zone in the database must not 500 a live webhook, so this falls back
 *    to UTC rather than propagating.
 */
export function zonedNow(at: Date, timeZone: string): ZonedNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone).formatToParts(at);
  } catch {
    parts = formatterFor('UTC').formatToParts(at);
  }

  let weekday = 0;
  let hour = 0;
  let minute = 0;
  for (const part of parts) {
    if (part.type === 'weekday') weekday = WEEKDAY_INDEX[part.value] ?? 0;
    else if (part.type === 'hour') hour = Number(part.value) % 24;
    else if (part.type === 'minute') minute = Number(part.value);
  }
  return { weekday, minutes: hour * 60 + minute };
}

/** True when `timeZone` is an IANA id this runtime knows. Used by the write validator. */
export function isValidTimeZone(timeZone: unknown): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Is `minutes` inside this day's own window?
 *
 * **Half-open: `open <= m < close`.** At exactly 17:00 a 09:00–17:00 company is CLOSED.
 * The alternative makes 17:00:30 still answer, which is not what "we close at five"
 * means. `open === close` is a zero-length window and therefore closed — 24 hours is
 * written `00:00`–`23:59`. A malformed time closes the day: **fail closed**, so a broken
 * config reaches the after-hours message instead of ringing somebody at 3am.
 */
function inWindow(day: WeeklyHours[number], minutes: number): boolean {
  if (!day) return false;
  const open = parseTime(day.open);
  const close = parseTime(day.close);
  if (open === null || close === null) return false;
  if (open === close) return false;
  // open > close is an overnight window; this is only its PRE-midnight part.
  return open < close ? minutes >= open && minutes < close : minutes >= open;
}

/**
 * Does YESTERDAY's overnight window still cover `minutes` this morning?
 *
 * This is the half that a naive same-day check gets wrong. A Friday 22:00–02:00 row means
 * Saturday 01:00 is open — but it also means **Friday 01:00 is CLOSED**, because Friday
 * 1am belongs to Thursday night and is governed by Thursday's row.
 */
function spilledFrom(day: WeeklyHours[number], minutes: number): boolean {
  if (!day) return false;
  const open = parseTime(day.open);
  const close = parseTime(day.close);
  if (open === null || close === null) return false;
  return open > close && minutes < close;
}

/**
 * The whole question, in one call.
 *
 * The week boundary needs no special case: Saturday (6) spills into Sunday (0) through
 * `(0 + 6) % 7`. That is index arithmetic on a 7-element array — deliberately NOT date
 * arithmetic, which is where DST bugs come from.
 */
export function isOpenAt(
  week: WeeklyHours,
  timeZone: string,
  at: Date,
): boolean {
  const { weekday, minutes } = zonedNow(at, timeZone);
  const today = week[weekday] ?? null;
  const yesterday = week[(weekday + 6) % 7] ?? null;
  return inWindow(today, minutes) || spilledFrom(yesterday, minutes);
}

/**
 * Today's window as speakable English, for the `{hours}` placeholder.
 *
 * Deliberately the SAME `zonedNow` the open/closed decision uses, so a caller can never be
 * told hours that contradict what actually happened to their call.
 */
export function describeToday(
  week: WeeklyHours,
  timeZone: string,
  at: Date,
): string {
  const { weekday } = zonedNow(at, timeZone);
  const day = week[weekday] ?? null;
  if (!day) return 'closed today';
  const open = parseTime(day.open);
  const close = parseTime(day.close);
  if (open === null || close === null || open === close) return 'closed today';
  return `${speak(day.open)} to ${speak(day.close)}`;
}

/** `"09:00"` → `"9 AM"`, `"17:30"` → `"5:30 PM"`. Read aloud, so no leading zeros. */
function speak(hhmm: string): string {
  const total = parseTime(hhmm) ?? 0;
  const hour24 = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour24 < 12 ? 'AM' : 'PM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return minute === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}
