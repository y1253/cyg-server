import { IsInt, Min } from 'class-validator';

/**
 * Who to hand a call to.
 *
 * A USER ID, never a phone number — the picker commits only directory choices, and this
 * is the server half of that same rule. It is why a transfer can never become an
 * outbound dialling surface: there is no field here that could carry an arbitrary
 * destination, so no validation is relied on to keep one out.
 *
 * The leg to redirect is derived server-side from the call, never sent by the client.
 */
export class TransferCallDto {
  @IsInt()
  @Min(1)
  targetUserId: number;
}
