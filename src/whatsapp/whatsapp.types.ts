/**
 * Shapes the WhatsApp routes return. The client mirrors these in `api/whatsapp.ts`.
 */

export type WhatsAppDirection = 'inbound' | 'outbound';

export type WhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export type WhatsAppMediaStatus = 'pending' | 'ready' | 'failed';

export type WhatsAppMessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'interactive'
  | 'button'
  | 'unsupported';

/** Where a company's number came from. See `WhatsAppAccount.origin`. */
export type WhatsAppOrigin = 'SIGNUP' | 'FIRM' | 'GENERATED';

/** Only CONNECTED sends or receives; the rest exist while a generated number verifies. */
export type WhatsAppSetupStatus =
  | 'PENDING_CODE'
  | 'VERIFYING'
  | 'CONNECTED'
  | 'FAILED';

export interface WhatsAppAccountView {
  companyId: number;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
  verifiedName: string | null;
  /** Attached with the server's own token rather than through Embedded Signup. */
  usesFirmToken: boolean;
  origin: WhatsAppOrigin;
  setupStatus: WhatsAppSetupStatus;
  /** Why setup failed, in words an admin can act on. */
  setupError: string | null;
  connectedAt: string;
}

export interface WhatsAppConnectResult {
  account: WhatsAppAccountView;
  /** Set when the number was saved but a follow-up step (registration) did not succeed. */
  warning: string | null;
}

/** Public config for the client's Embedded Signup popup. Never carries a secret. */
export interface WhatsAppClientConfig {
  appId: string | null;
  configId: string | null;
  graphVersion: string;
  /** The server holds a firm token + WABA, so "Generate WhatsApp account" can work. */
  generateAvailable: boolean;
}

export interface WhatsAppItemDto {
  /** `wa:{id}` -- namespaced like `swsms:`, so it can share the inbox's id space. */
  id: string;
  messageId: number;
  kind: 'whatsapp';
  direction: WhatsAppDirection;
  /** Digits only. */
  peer: string;
  /** Saved contact name, else the WhatsApp profile name, else null. */
  peerName: string | null;
  type: WhatsAppMessageType;
  body: string | null;
  isVoice: boolean;
  durationSec: number | null;
  hasMedia: boolean;
  mediaStatus: WhatsAppMediaStatus | null;
  mimeType: string | null;
  filename: string | null;
  size: number | null;
  status: WhatsAppDeliveryStatus | null;
  errorCode: string | null;
  at: string;
  isRead: boolean;
  isCompleted: boolean;
  /**
   * The message this one replies to, as OUR id. Null when it is not a reply, and also when
   * the quoted message falls outside the loaded page — the client shows an unresolved
   * quote for that, exactly as `ChatBubble` does.
   */
  replyToMessageId: number | null;
}

export interface WhatsAppTimelineResult {
  items: WhatsAppItemDto[];
  nextCursor: number | null;
  hasMore: boolean;
  connected: boolean;
}

export interface WhatsAppThreadResult {
  messages: WhatsAppItemDto[];
  peer: string;
  peerName: string | null;
  /** ISO. Free-form replies are only accepted before this; null = customer never wrote. */
  windowOpenUntil: string | null;
  connected: boolean;
}

export interface WhatsAppCounts {
  unread: number;
  uncompleted: number;
}

export type WhatsAppStateAction = 'read' | 'unread' | 'complete' | 'uncomplete';

/**
 * One approved template, flattened to what a picker needs.
 *
 * Only the BODY component is modelled. Header/footer/button components exist and are
 * passed through untouched when sending, but they are not offered for editing — a
 * template with a media header needs a media id, which is a different feature.
 */
export interface WhatsAppTemplateDto {
  /** Meta's own id. Null only for a row old enough to predate us asking for the field. */
  id: string | null;
  name: string;
  /** BCP-47ish code Meta stores, e.g. `en_US`. Sent back verbatim. */
  language: string;
  category: string;
  /**
   * The body text exactly as submitted, `{{1}}` placeholders intact.
   *
   * Null for a template with no BODY component (an AUTHENTICATION template, or one built
   * in Business Manager with only a media header). Such a template is listed so it can be
   * SEEN, and refused at selection — see `toTemplate`.
   */
  body: string | null;
  /** How many `{{n}}` placeholders the body carries — the picker renders this many inputs. */
  variableCount: number;
  /**
   * Meta's review state. Only `APPROVED` may be sent.
   *
   * Carried because the list is no longer filtered to APPROVED: a template somebody just
   * submitted has to be visible while Meta reviews it, which is the entire point of being
   * able to create one from here.
   */
  status: string;
  /** Why Meta refused it, when it did. The only thing that says what to change. */
  rejectedReason: string | null;
}

/**
 * One template THIS company submitted, as the inbox strip renders it.
 *
 * Deliberately NOT `WhatsAppTemplateDto`: that one answers "what may I send" and is
 * WABA-wide, this one answers "what did we submit" and is company-scoped. They differ in
 * scope, in lifetime and in who may see them.
 */
export interface WhatsAppSubmissionDto {
  id: number;
  name: string;
  language: string;
  category: string;
  body: string;
  examples: string[];
  status: string;
  rejectedReason: string | null;
  submittedAt: string;
}
