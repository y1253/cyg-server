import {
  IsInt,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * "Complete everything in this conversation up to here."
 *
 * ── WHY AN ANCHOR AND NOT A LIST OF IDS ────────────────────────────────────────
 * The obvious shape is for the client to post the ids it already has — every thread view
 * holds the whole conversation. Three things make that wrong, and the third is decisive:
 *
 *  - every thread view is CAPPED (one chat page, 200 texts, 200 WhatsApp rows), so "till
 *    here" would silently skip anything older than the cap;
 *  - an id list is an arbitrary-id writer into `MessageCompletedState`, a table shared
 *    with every mailbox in the firm — the risk `isPhoneItemId` exists to close;
 *  - and to validate such a list the server has to rebuild the thread anyway, so the
 *    client's copy buys nothing while costing both of the above.
 *
 * So the client names ONE message and the server enumerates. See `idsUpTo`.
 */
export class CompleteUntilEmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  threadId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  messageId: string;
}

export class CompleteUntilChatDto {
  /** Contains a "/", which is why it travels in the body and never as a path segment. */
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  spaceId: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  messageId: string;
}

export class CompleteUntilSmsDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  peer: string;

  /** `swsms:{sid}` — the row's own id, as the thread reports it. */
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  itemId: string;
}

export class CompleteUntilIdDto {
  @IsInt()
  @IsPositive()
  messageId: number;
}
