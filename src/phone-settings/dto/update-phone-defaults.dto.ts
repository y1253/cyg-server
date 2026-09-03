import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { WeeklyHours } from '../phone-settings.util.js';
import { IsIanaTimeZone, IsWeeklyHours } from '../phone-settings.validators.js';

/**
 * A partial update of the GLOBAL defaults.
 *
 * Every field is optional but **non-nullable** — this row is the bottom of the resolution
 * chain, so there is nothing below it to inherit from and `null` would be meaningless.
 * The per-company DTO is the mirror image: there, `null` is the whole point.
 *
 * The global ValidationPipe runs `whitelist: true`, so any field without a decorator here
 * is silently stripped from the body.
 */
export class UpdatePhoneDefaultsDto {
  @IsOptional()
  @IsIanaTimeZone()
  timezone?: string;

  @IsOptional()
  @IsWeeklyHours()
  weeklyHours?: WeeklyHours;

  // 1000 chars is roughly a minute of speech. Without a cap, a pasted document becomes a
  // novel read aloud to a client who called to ask about an invoice.
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  greetingMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  afterHoursMessage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  unavailableMessage?: string;

  @IsOptional()
  @IsBoolean()
  playGreeting?: boolean;

  @IsOptional()
  @IsBoolean()
  afterHoursHangUp?: boolean;

  @IsOptional()
  @IsBoolean()
  hoursEnabled?: boolean;

  // Below ~5s nobody can reach a phone; above ~120s the caller has hung up and we are
  // paying for the leg.
  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  ringTimeoutSeconds?: number;

  /** `''` is legal and means "omit the voice attribute, take the provider default". */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  voice?: string;

  /**
   * PhoneAudio id, or 0 for "no hold music".
   *
   * @Min(0) not @Min(1): 0 is a legitimate value, and rejecting it would leave an admin
   * unable to turn hold music back off once it had been turned on.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  holdAudioId?: number;

  @IsOptional()
  @IsBoolean()
  voicemailEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  voicemailPrompt?: string;

  // Under 10s nobody can say anything; over 10 minutes is a stored file nobody plays.
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  voicemailMaxSeconds?: number;
}
