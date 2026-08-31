import { IsString, MaxLength, MinLength, Matches } from 'class-validator';

/**
 * Body for sending an SMS from a company's support number.
 *
 * Note there is no `from`: it is derived server-side from the company's active
 * `SupportNumber`. Accepting it from the client would let any caller send from any
 * number the account owns, billed to us and attributed to another company.
 */
export class SendSmsDto {
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'to must be E.164, e.g. +15145551234',
  })
  to: string;

  /**
   * 1600 characters is ten SMS segments — the point past which a "text message" is
   * really an email and the per-segment cost stops being incidental.
   */
  @IsString()
  @MinLength(1, { message: 'Message body is required' })
  @MaxLength(1600, { message: 'Message is longer than 10 SMS segments' })
  body: string;
}
