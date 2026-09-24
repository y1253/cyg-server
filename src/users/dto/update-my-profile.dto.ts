import { IsOptional, Matches } from 'class-validator';

/**
 * What a user may change about THEMSELVES.
 *
 * ⚠️ Deliberately NOT `UpdateUserDto`, and deliberately not a subclass of it. That one
 * also carries `name`, `email` and `role` — and `UsersService.update` writes any of them
 * it is handed — so reusing it on a self-service route would let a USER `PATCH` themselves
 * to ADMIN. Keeping the editable surface to ONE field is what makes "a user may only edit
 * their cell number" structurally true, rather than a check somebody can later forget.
 *
 * The rule below is a byte-for-byte copy of `UpdateUserDto.phoneE164`, and must stay one:
 * this number is DIALLED (`RingGroupService` puts it verbatim into a `<Number>` noun on a
 * live call), so the two write paths cannot disagree about what is acceptable.
 *
 * `null` CLEARS the number and an absent key leaves it alone. `@IsOptional()` skips
 * validation for `null` as well as `undefined`, which is what lets the null through
 * `@Matches` to reach the service's `!== undefined` gate.
 */
export class UpdateMyProfileDto {
  @IsOptional()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phoneE164 must be E.164, e.g. +15145551234',
  })
  phoneE164?: string | null;
}
