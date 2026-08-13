// ─── Provider-agnostic DTOs for the unified Communications inbox ─────────────
// Both the Gmail (Google) and Microsoft (Outlook + Teams) provider services
// return these exact shapes so the client renders either provider identically.
// The client's merge/sort/optimistic logic depends on these keys being stable.

export type CommunicationsProviderKind = 'GOOGLE' | 'MICROSOFT';

// A single chat message (Google Chat or Microsoft Teams) as shown to the client.
export interface ChatMessageDto {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceType: string;
  sender: string;
  text: string;
  createTime: string;
  // Needed to quote this message when replying (Google Chat quotedMessageMetadata;
  // ignored by Teams).
  lastUpdateTime: string;
  // Resource name of the message THIS message quotes (if any). null when none.
  quotedMessageName?: string | null;
  isOwn?: boolean;
  attachments?: ChatAttachmentDto[];
}

// Attachment metadata for an email (Gmail MIME part / Graph fileAttachment).
export interface EmailAttachmentDto {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  // Content-ID (angle brackets stripped) for resolving inline `cid:` refs. null when none.
  contentId: string | null;
  // True when displayed inline in the body — hidden from the attachment strip.
  isInline: boolean;
}

// Attachment metadata for a chat message. `resourceName` streams uploaded bytes;
// external-hosted files (Drive / SharePoint / OneDrive) expose a link instead.
export interface ChatAttachmentDto {
  name: string;
  contentName: string;
  contentType: string;
  resourceName: string | null;
  driveFileId: string | null;
  thumbnailUri: string | null;
  downloadUri: string | null;
  source: string | null;
}

// Why chat sender names couldn't be resolved (Google People API only). Microsoft
// always returns names inline, so its provider reports null.
export type SenderNamesUnavailable = 'scopes' | 'api_disabled' | 'undisclosed';

export type ChatStatus =
  | 'ok'
  | 'needs_reconnect'
  | 'no_spaces'
  | 'app_not_configured'
  | 'chat_disabled'
  // Account has no Microsoft Teams / Office 365 license (Graph 403 "license").
  // Distinct from chat_disabled: reconnecting won't help — it's an admin/licensing fix.
  | 'no_license'
  | 'error';

// getChats() wrapper.
export interface ChatListResult {
  messages: (ChatMessageDto & {
    isRead: boolean;
    isCompleted: boolean;
    hasAttachments: boolean;
  })[];
  needsReconnect: boolean;
  chatStatus: ChatStatus;
  senderNamesUnavailable: SenderNamesUnavailable | null;
  nextCursor: string | null;
  hasMore: boolean;
}

// getChatThread() wrapper.
export interface ChatThreadResult {
  messages: ChatMessageDto[];
  nextPageToken: string | null;
  spaceName?: string;
  spaceType?: string;
  needsReconnect?: boolean;
}

// A single row in the email list.
export interface EmailSummaryDto {
  id: string;
  // Conversation id (Gmail threadId / Outlook conversationId). Lets the client
  // open the whole conversation thread in one request when a row is clicked.
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  isRead: boolean;
  isCompleted: boolean;
  isForwarded: boolean;
  attachments: EmailAttachmentDto[];
}

// getEmails() wrapper.
export interface EmailListResult {
  messages: EmailSummaryDto[];
  nextPageToken: string | null;
  // Set when the mailbox could not be read because the account's token/grant was
  // rejected (401/403). Lets the client show a "reconnect" banner instead of a
  // blank inbox (mirrors ChatListResult.needsReconnect).
  needsReconnect?: boolean;
}

// getEmailThread() wrapper — the full conversation, oldest → newest.
export interface EmailThreadResult {
  messages: EmailDetailDto[];
  needsReconnect?: boolean;
}

// getEmail() detail.
export interface EmailDetailDto {
  id: string;
  threadId: string;
  messageId: string;
  subject: string;
  from: string;
  to: string;
  // Comma-joined `Name <email>` list, same shape as `to`. Empty when nobody was
  // copied. Bcc is deliberately absent: Gmail never returns a Bcc header on
  // received mail and Graph only fills bccRecipients on messages you sent.
  cc: string;
  date: string;
  snippet: string;
  bodyHtml: string | null;
  bodyText: string | null;
  attachments: EmailAttachmentDto[];
  isRead?: boolean;
  isCompleted?: boolean;
  isForwarded: boolean;
  // One entry per forward event, oldest first. `messageId` is the id of the sent
  // forward (null for legacy rows) — lets the client open the full forward.
  forwards: { to: string; at: string; messageId: string | null }[];
}

// getAccount() shape. `emailAddress` is the canonical field; `gmailAddress` is
// kept as an alias so the existing client keeps working during the transition.
export interface CommunicationsAccountDto {
  provider: CommunicationsProviderKind;
  emailAddress: string;
  gmailAddress: string;
  connectedAt: string | Date;
  hasChatScope: boolean;
  signatureHtml: string;
}
