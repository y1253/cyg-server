import type {
  ChatListResult,
  ChatThreadResult,
  CommunicationsAccountDto,
  CommunicationsProviderKind,
  EmailDetailDto,
  EmailListResult,
  EmailThreadResult,
} from './communications.types.js';

/**
 * The contract both provider services (GmailService, MicrosoftService) satisfy so
 * the unified Communications UI is provider-agnostic. Each provider owns its own
 * transport (Google APIs vs Microsoft Graph) but returns the shared DTO shapes.
 *
 * The two providers are also wired to nearly-identical controllers (`/api/gmail/*`
 * and `/api/microsoft/*`); this interface documents the shared surface and lets the
 * resolver treat a company's connected account uniformly (e.g. the cross-company
 * uncompleted-count badge in CommunicationsController).
 */
export interface CommunicationsProvider {
  readonly providerKind: CommunicationsProviderKind;

  // Account / connection
  getAccount(companyId: number): Promise<CommunicationsAccountDto | null>;
  disconnect(companyId: number): Promise<void>;

  // Email
  getEmails(
    companyId: number,
    pageToken?: string,
    labelIds?: string[],
    q?: string,
  ): Promise<EmailListResult>;
  getEmail(
    companyId: number,
    messageId: string,
    immutable?: boolean,
  ): Promise<EmailDetailDto>;
  getEmailThread(
    companyId: number,
    threadId: string,
  ): Promise<EmailThreadResult>;
  markAsRead(companyId: number, messageId: string): Promise<void>;
  markAsUnread(companyId: number, messageId: string): Promise<void>;

  // Chat
  getChats(
    companyId: number,
    cursor?: string,
    q?: string,
  ): Promise<ChatListResult>;
  getChatThread(
    companyId: number,
    spaceId: string,
    pageToken?: string,
  ): Promise<ChatThreadResult>;

  // Shared inbox state (delegated to MessageStateService, exposed for the controller)
  markChatRead(companyId: number, messageId: string): Promise<void>;
  markChatUnread(companyId: number, messageId: string): Promise<void>;
  markComplete(companyId: number, messageId: string): Promise<void>;
  markUncomplete(companyId: number, messageId: string): Promise<void>;

  // Badge counts
  getUnreadCount(companyId: number): Promise<{ count: number }>;
  getUncompletedCount(companyId: number): Promise<{ count: number }>;
  getUncompletedCounts(): Promise<Record<number, number>>;
}
