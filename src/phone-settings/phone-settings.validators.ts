import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isValidTimeZone } from './phone-hours.util.js';
import {
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY_CHARS,
  parseWeeklyHours,
} from './phone-settings.util.js';

/**
 * An IANA timezone id this runtime actually knows.
 *
 * Validated against the ICU database itself rather than a hardcoded list, because the
 * list the client offers is a convenience menu while the resolver reads ICU — a
 * hardcoded server-side list would drift from the one that decides whether a call rings.
 *
 * `null` passes: on the per-company DTO it means "inherit", and `@IsOptional()` would let
 * it through anyway.
 */
export function IsIanaTimeZone(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isIanaTimeZone',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => value === null || isValidTimeZone(value),
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be an IANA timezone id, e.g. America/Toronto`,
      },
    });
  };
}

/**
 * A 7-element week of `{ open, close }` / `null` days.
 *
 * Delegates to `parseWeeklyHours` — the SAME function the resolver uses — so the shape
 * the API accepts and the shape the webhook understands cannot drift apart. A bespoke
 * validator here would eventually accept something the resolver silently discards, and
 * the admin would see their hours saved and ignored.
 */
export function IsWeeklyHours(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isWeeklyHours',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) =>
          value === null || parseWeeklyHours(value) !== null,
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be 7 entries (0=Sunday), each null or ` +
          `{ "open": "09:00", "close": "17:00" } in 24-hour HH:mm`,
      },
    });
  };
}

/**
 * A list of canned replies.
 *
 * Delegates to `parseQuickReplies` — the SAME function the resolver uses — for the reason
 * `IsWeeklyHours` gives: a bespoke validator here would eventually accept something the
 * resolver discards, and the admin would watch their replies save and then not appear.
 *
 * ⚠️ It also checks the RAW list rather than the parsed one, because `parseQuickReplies`
 * silently drops entries that are too long or too many. Saving six replies and getting
 * three back with no explanation is worse than being told which rule was broken.
 */
export function IsQuickReplies(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isQuickReplies',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => {
          if (value === null) return true;
          if (!Array.isArray(value)) return false;
          if (value.length > MAX_QUICK_REPLIES) return false;
          return value.every(
            (v) =>
              typeof v === 'string' &&
              v.trim().length > 0 &&
              v.trim().length <= MAX_QUICK_REPLY_CHARS,
          );
        },
        defaultMessage: (args: ValidationArguments) =>
          `${args.property} must be at most ${MAX_QUICK_REPLIES} messages, ` +
          `each 1-${MAX_QUICK_REPLY_CHARS} characters`,
      },
    });
  };
}
