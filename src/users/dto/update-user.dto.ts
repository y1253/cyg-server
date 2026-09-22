import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  /**
   * See `CreateUserDto.phoneE164` for why this is `@Matches` and not `@IsString()`.
   *
   * `null` CLEARS the number and an absent key leaves it alone — the same two-state
   * distinction `pickPresent` draws in phone-settings. `@IsOptional()` skips validation for
   * `null` as well as `undefined`, which is what lets the null through `@Matches` to reach
   * the service's `!== undefined` gate.
   */
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneE164 must be E.164, e.g. +15145551234',
  })
  phoneE164?: string | null;
}
