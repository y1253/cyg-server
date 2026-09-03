import { IsInt, Min } from 'class-validator';

/**
 * Who to call.
 *
 * A USER ID, never an address or a number — the picker only commits directory choices,
 * so a typo cannot become a callee. Same rule as internal message recipients.
 */
export class StartInternalCallDto {
  @IsInt()
  @Min(1)
  calleeId!: number;
}
