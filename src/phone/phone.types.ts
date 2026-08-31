/**
 * The shapes the Communications inbox renders for phone activity.
 *
 * Deliberately NOT in `communications/communications.types.ts`: that file's contract is
 * "both provider services return these exact shapes", and phone is not a provider — it
 * exists per company independently of whether a mailbox is connected at all. The client
 * mirrors these in `api/phone.ts`, the same way `api/gmail.ts` mirrors the
 * communications types.
 */

/** Discriminates the two phone rows inside the client's unified inbox. */
export type PhoneItemKind = 'call' | 'sms';

interface PhoneItemBase {
  /**
   * ALREADY NAMESPACED — `swcall:{sid}` / `swsms:{sid}`.
   *
   * This is the row key, the client's selection key, and the `messageId` written to
   * `ChatMessageReadState` / `MessageCompletedState`. The namespace is not decoration:
   * SignalWire SIDs are plain UUIDs, so a call SID and a message SID are
   * indistinguishable on sight, and both share those tables with Gmail ids, Outlook
   * restIds and Google Chat resource names. The raw `sid` is kept separately for the
   * round-trips that need it.
   */
  id: string;
  sid: string;
  kind: PhoneItemKind;
  direction: 'inbound' | 'outbound';
  /**
   * The customer's number, E.164 — whichever leg it sits on. This is what the row
   * shows, what "call back" dials, and what keys an SMS conversation.
   */
  counterparty: string;
  /** The company's support number this happened on. */
  supportNumber: string;
  /** ISO 8601. The merge key against emails and chat messages. */
  at: string;
  isRead: boolean;
  isCompleted: boolean;
}

export interface CallItemDto extends PhoneItemBase {
  kind: 'call';
  /** Raw SignalWire status, kept for the detail view and for debugging. */
  status: string;
  /**
   * What a human would say happened.
   *
   * NOT derivable from `status` alone: an inbound call nobody picked up still reports
   * `status: completed` on the leg we can see, because the `<Dial>` verb itself
   * completed. The truth lives on the SIP child leg. See `phone-timeline.service.ts`.
   */
  outcome: 'answered' | 'missed' | 'failed' | 'in-progress';
  durationSec: number;
  hasRecording: boolean;
}

export interface SmsItemDto extends PhoneItemBase {
  kind: 'sms';
  body: string;
  numMedia: number;
  status: string;
  /** SignalWire's delivery error, when it reported one (e.g. 10DLC filtering). */
  errorCode: number | null;
}

export type PhoneItemDto = CallItemDto | SmsItemDto;

/** One page of the merged calls + SMS feed, newest first. */
export interface PhoneTimelineResult {
  items: PhoneItemDto[];
  /** ISO of the oldest item served; pass back as `before` for the next page. */
  nextCursor: string | null;
  hasMore: boolean;
  /**
   * False when the company has no support number at all — the client hides the phone
   * source entirely rather than showing an empty channel that can never fill.
   */
  hasNumber: boolean;
  /** The active support number, so the client can label the channel. */
  supportNumber: string | null;
}

/** A recording available for one call. */
export interface RecordingDto {
  sid: string;
  durationSec: number;
  createdAt: string | null;
  /**
   * Short-lived, bound to THIS recording, minted only after the call was confirmed to
   * be on the company's number. The stream route accepts nothing else — see
   * `recording-token.util.ts`.
   */
  token: string;
}

/** One message in an SMS conversation, oldest first. */
export interface SmsThreadResult {
  messages: SmsItemDto[];
  /** The number the conversation is with. */
  peer: string;
  supportNumber: string | null;
}
