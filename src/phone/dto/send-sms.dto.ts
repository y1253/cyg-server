import { IsOptional, IsString, MaxLength, Matches } from 'class-validator';

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
   *
   * ⚠️ OPTIONAL, not required, since this route gained attachments: an MMS carrying a
   * picture and no words is an ordinary thing to send. "Body or media" cannot be expressed
   * here — the uploaded files are not part of the DTO — so the service enforces it, where
   * both halves are visible.
   */
  @IsOptional()
  @IsString()
  @MaxLength(1600, { message: 'Message is longer than 10 SMS segments' })
  body?: string;
}
