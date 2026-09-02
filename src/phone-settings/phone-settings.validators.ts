import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import { isValidTimeZone } from './phone-hours.util.js';
import { parseWeeklyHours } from './phone-settings.util.js';

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
