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
  /** The server holds a firm token + number, so "Use firm number" can work. */
  firmNumberAvailable: boolean;
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
