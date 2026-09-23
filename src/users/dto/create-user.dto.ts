import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsEnum(Role)
  role: Role;

  /**
   * The staff member's own phone. Optional — a user with none is rung in the browser only.
   *
   * `@Matches(E164)` rather than the lenient `@IsString() @MinLength()` shape
   * `CreateContactDto.phone` uses, per the split that DTO's own docblock draws: a number
   * that is FILED is worth saving however it was typed, but this one is DIALLED — the ring
   * group hands it verbatim to `createCall` as the `To` of a real PSTN leg.
   *
   * Normalisation (`toE164`) happens in the CLIENT, not here. A server that silently
   * guesses `+1` for a bare ten digits is guessing a country code for a number it is about
   * to dial; the client can show the admin the normalised form before they save it.
   */
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneE164 must be E.164, e.g. +15145551234',
  })
  phoneE164?: string;
}
