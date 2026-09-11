import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/**
 * Who to bring into a live call.
 *
 * ⚠️ Note how this DIFFERS from `TransferCallDto`, which accepts a user id and nothing
 * else so that a transfer structurally cannot become an outbound-dialling surface.
 *
 * Adding a person deliberately CAN dial a number — a three-way call with an outside
 * party is most of the point — and that is not a new surface: click-to-call already
 * accepts an arbitrary E.164 number behind the same `assertMayUseCompanyPhone` check on
 * the same company's caller ID. What stays true is that the server decides what is
 * actually dialled: a `contactId` is looked up against THIS company's contacts and the
 * number read off the row, never taken from the request.
 *
 * Exactly one of the three should be sent; the service resolves them in the order
 * userId → phone → contactId.
 */
export class AddCallDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  targetUserId?: number;

  /** Same expression as `StartCallDto.to`, so the two dialling paths cannot drift. */
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be an E.164 number, e.g. +14382561210',
  })
  phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  contactId?: number;
}

/**
 * Which person on the call, and what to do to them.
 *
 * ⚠️ `partyId` is an OPAQUE id the server handed out (`peer`, `p2`, …) — never a call
 * sid. A child leg touches no support number, so `assertCallBelongsTo` would never check
 * it, and accepting one here would be a "redirect any call on the account" primitive.
 */
export class PartyHoldDto {
  @IsString()
  partyId!: string;

  @IsBoolean()
  held!: boolean;
}

export class PartyDto {
  @IsString()
  partyId!: string;
}
