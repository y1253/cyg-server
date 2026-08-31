import { IsString, Matches } from 'class-validator';

/**
 * Body for the read / unread / complete / uncomplete routes.
 *
 * The id travels in the BODY, not the path: it contains a ':' and would need
 * encoding, and the chat routes already set that precedent for ids that are not
 * path-safe.
 *
 * The pattern is the real guard. These routes write straight into
 * `ChatMessageReadState` / `MessageCompletedState`, which are shared with every
 * mailbox — without it, an authenticated user could mark another company's email
 * complete simply by passing its Gmail id here, or fill the table with junk.
 */
export class PhoneItemStateDto {
  @IsString()
  @Matches(/^sw(call|sms):[A-Za-z0-9_.-]{1,120}$/, {
    message: 'itemId must be a phone item id, e.g. swcall:<sid>',
  })
  itemId: string;
}
