import { IsInt, Max, Min } from 'class-validator';

/**
 * Which canned reply to send.
 *
 * ⚠️ An INDEX into the company's configured list, never the text itself. Accepting a body
 * would make this an "send any SMS from any company's support number" primitive that is
 * reachable from a ringing call — and the whole point of configuring the replies in phone
 * settings is that what goes out is something an admin approved.
 */
export class QuickReplyDto {
  @IsInt()
  @Min(0)
  @Max(20)
  index: number;
}
