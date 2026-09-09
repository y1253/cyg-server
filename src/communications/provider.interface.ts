import type {
  ChatListResult,
  ChatThreadResult,
  CommunicationsAccountDto,
  CommunicationsProviderKind,
  DraftDetailDto,
  DraftRefDto,
  EmailDetailDto,
  EmailListResult,
  EmailThreadResult,
  LatestPreviewDto,
} from './communications.types.js';
import type { SaveDraftDto } from '../gmail/dto/save-draft.dto.js';
import type { OutboundFile } from './outbound-uploads.js';

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

  // Drafts
  //
  // Listing is deliberately NOT here: a draft list is `getEmails` with the provider's
  // drafts label, so the Drafts folder reuses the whole existing list/paging path
  // rather than growing a parallel one.
  //
  // `draftId` is the only id a caller may hold. Gmail gives a draft two (the draft
  // resource and the message inside it) and every write is keyed by the first.
  createDraft(
    companyId: number,
    dto: SaveDraftDto,
    attachments: OutboundFile[],
  ): Promise<DraftRefDto>;
  updateDraft(
    companyId: number,
    draftId: string,
    dto: SaveDraftDto,
  ): Promise<DraftRefDto>;
  getDraft(companyId: number, draftId: string): Promise<DraftDetailDto>;
  deleteDraft(companyId: number, draftId: string): Promise<void>;
  /** Resolves once the provider has accepted the message. */
  sendDraft(companyId: number, draftId: string): Promise<unknown>;


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

  /**
   * Newest inbox item (email or chat, whichever is more recent) for a popup body.
   * Returns null when the mailbox is empty or the lookup fails — a popup with a
   * generic body beats no popup at all.
   */
  getLatestPreview(companyId: number): Promise<LatestPreviewDto | null>;

  // Badge counts
  getUnreadCount(companyId: number): Promise<{ count: number }>;
  getUncompletedCount(companyId: number): Promise<{ count: number }>;
  getUncompletedCounts(): Promise<Record<number, number>>;
}
