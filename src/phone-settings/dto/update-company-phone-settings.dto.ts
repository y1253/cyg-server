import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type { WeeklyHours } from '../phone-settings.util.js';
import { IsIanaTimeZone, IsWeeklyHours } from '../phone-settings.validators.js';

/**
 * A partial update of ONE company's overrides.
 *
 * ── ABSENT AND NULL MEAN DIFFERENT THINGS ───────────────────────────────────────
 *   key absent      → leave this override exactly as it is
 *   `"key": null`   → CLEAR the override; this field goes back to inheriting
 *   `"key": value`  → set the override
 *
 * The service distinguishes the first two with `hasOwnProperty`, not by truthiness. That
 * matters because `false`, `0` and `''` are legitimate override VALUES here, and a
 * `filter(([, v]) => v)` would silently drop all three.
 *
 * `@ValidateIf(v !== null)` is what lets an explicit `null` bypass `@IsString()` /
 * `@MaxLength` while a non-null value is still checked. `@IsOptional()` alone would do
 * it too, but stating the null case explicitly is the point of this DTO.
 */
export class UpdateCompanyPhoneSettingsDto {
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string | null;

  @IsOptional()
  @IsWeeklyHours()
  weeklyHours?: WeeklyHours | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  greetingMessage?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  afterHoursMessage?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(1000)
  unavailableMessage?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  playGreeting?: boolean | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  afterHoursHangUp?: boolean | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsBoolean()
  hoursEnabled?: boolean | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(5)
  @Max(120)
  ringTimeoutSeconds?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(64)
  voice?: string | null;
}
