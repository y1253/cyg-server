import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { encrypt, decrypt } from '../communications/crypto.util.js';
import {
  generateOAuthState,
  verifyOAuthState,
} from '../communications/oauth-state.util.js';
import type {
  ChatListResult,
  ChatThreadResult,
  CommunicationsAccountDto,
  EmailAttachmentDto,
  EmailDetailDto,
  EmailListResult,
  EmailSummaryDto,
  EmailThreadResult,
} from '../communications/communications.types.js';
import type { CommunicationsProvider } from '../communications/provider.interface.js';
import { SendEmailDto } from '../gmail/dto/send-email.dto.js';
import { SendChatMessageDto } from '../gmail/dto/send-chat-message.dto.js';
import {
  buildMicrosoftAuthUrl,
  redeemMicrosoftCode,
  refreshMicrosoftTokens,
  scopesFor,
  type MicrosoftConnectKind,
} from './msal.util.js';
import {
  chatDisplayName,
  chatSpaceType,
  formatGraphAddress,
  formatGraphAddressList,
  graphGet,
  graphGetBinary,
  graphPatch,
  graphPost,
  GraphError,
  htmlToText,
  teamsStateId,
  TEAMS_PREFIX,
  type GraphAttachment,
  type GraphChat,
  type GraphChatMessage,
  type GraphList,
  type GraphMessage,
} from './graph.util.js';
import { insertAboveQuote, textToHtml } from './draft-body.util.js';

/** A multer file as it arrives from `FilesInterceptor`. */
interface UploadedFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

// Bounded concurrency: a cold uncompleted-count fans out to a message list per
// chat, so don't launch them all at once.
async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return out;
}

const SPACE_CAP = 20; // chats scanned for the inbox
const MSG_PER_SPACE = 15; // recent messages per chat (mirrors Gmail's ~15/space)
const EMAIL_SELECT =
  'id,subject,from,sender,toRecipients,receivedDateTime,sentDateTime,bodyPreview,isRead,hasAttachments,conversationId,internetMessageId';
// `contentId` lives only on the `fileAttachment` subtype, not the base
// `attachment` type — selecting it bare makes Graph 400 (blank inbox). The
// derived-type cast is the OData-correct way to pull it while still selecting
// the base props.
const ATTACH_EXPAND =
  'attachments($select=id,name,contentType,size,isInline,microsoft.graph.fileAttachment/contentId)';

@Injectable()
export class MicrosoftService implements CommunicationsProvider {
  readonly providerKind = 'MICROSOFT' as const;
  private readonly logger = new Logger(MicrosoftService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MessageStateService,
  ) {}

  /**
   * The key an email uses in the shared state tables (completed / forwarded).
   *
   * NOT the Graph id. Graph's default restId is documented as changing whenever
   * the message moves container — Focused/Other reclassification, an inbox rule,
   * archive, a mobile client — which orphaned the state row and made "mark
   * complete" silently revert on the next refresh. The RFC 5322 `Message-ID`
   * never changes, for work *and* personal accounts (unlike immutable ids, which
   * are an Exchange Online feature and would need the `Prefer` header on every
   * single call to hold). Graph restIds are still what we address messages by.
   *
   * Falls back to the restId when Graph omits the header (drafts) so the key is
   * never empty; such messages aren't in the inbox list anyway.
   */
  private stateKey(m: { id: string; internetMessageId?: string }): string {
    return m.internetMessageId ?? m.id;
  }

  /**
   * Shared-state lookup that also honours rows written before the key moved from
   * the Graph restId to the Message-ID. Without this, every message already
   * marked complete would pop back to uncompleted the moment this ships.
   */
  private isMarked(
    set: Set<string>,
    m: { id: string; internetMessageId?: string },
  ): boolean {
    return set.has(this.stateKey(m)) || set.has(m.id);
  }

  /**
   * Rewrites completed rows that still carry a Graph restId over to the
   * Message-ID, using the inbox list we already fetched. Converges after one
   * pass (the next list finds nothing stale) and is a no-op forever after, which
   * is why this needs no deploy-time migration step. The old rows are left in
   * place — they're a few bytes each, `isMarked` still honours them, and
   * deleting them would risk a partial delete reading as "uncompleted".
   */
  private async upgradeLegacyCompletedKeys(
    companyId: number,
    msgs: { id: string; internetMessageId?: string }[],
    completedSet: Set<string>,
  ): Promise<void> {
    const stale = msgs.filter(
      (m) =>
        m.internetMessageId &&
        !completedSet.has(m.internetMessageId) &&
        completedSet.has(m.id),
    );
    if (stale.length === 0) return;
    try {
      const written = await this.state.flushCompleted(
        companyId,
        stale.map((m) => this.stateKey(m)),
      );
      this.logger.log(
        `[Microsoft] re-keyed ${written} completed rows to Message-ID for company ${companyId}`,
      );
    } catch (err) {
      // Never let a migration hiccup blank the inbox.
      this.logger.warn(
        `re-key of completed rows failed for company ${companyId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Forward history, falling back to any row still keyed on the restId. */
  private async forwardsFor(
    companyId: number,
    m: { id: string; internetMessageId?: string },
  ) {
    const rows = await this.state.getForwards(companyId, this.stateKey(m));
    if (rows.length > 0 || this.stateKey(m) === m.id) return rows;
    return this.state.getForwards(companyId, m.id);
  }

  /**
   * Resolves a Graph restId (what the client sends) to its `stateKey`. Used by
   * the write paths, which only receive the id the UI was rendered with.
   */
  private async stateKeyForId(
    companyId: number,
    graphId: string,
  ): Promise<string> {
    // Teams chat ids are already state keys — they're not Graph message ids.
    if (graphId.startsWith(TEAMS_PREFIX)) return graphId;
    try {
      const m = await this.withGraph(companyId, (t) =>
        graphGet<GraphMessage>(
          t,
          `/me/messages/${graphId}?$select=id,internetMessageId`,
        ),
      );
      return this.stateKey(m);
    } catch (err) {
      // The id may have already rotated out from under us. Fall back to writing
      // the raw id rather than failing the user's click outright.
      this.logger.warn(
        `stateKeyForId(company=${companyId}) failed, using raw id: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return graphId;
    }
  }

  // Log the real reason a Graph call failed so production `pm2 logs` can tell a
  // 403 (missing Graph permission / admin consent) from a 401 (bad token) from a
  // token-refresh/decrypt throw. Returns true when the failure is an auth error
  // the user can fix by re-connecting the account.
  private logGraphFailure(
    op: string,
    companyId: number,
    err: unknown,
  ): boolean {
    if (err instanceof GraphError) {
      this.logger.error(
        `${op} failed for company ${companyId}: Graph ${err.status} ${err.graphCode ?? ''} — ${err.message}`,
      );
      return err.status === 401 || err.status === 403;
    }
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`${op} failed for company ${companyId}: ${message}`);
    // A getAccessToken throw (refresh/decrypt failure) is also a reconnect-worthy
    // auth problem — but not a genuine "no account" NotFoundException.
    return !(err instanceof NotFoundException);
  }

  // ── OAuth ────────────────────────────────────────────────────────────────

  async generateAuthUrl(
    companyId: number,
    userId: number,
    kind: MicrosoftConnectKind = 'work',
  ): Promise<{ authUrl: string }> {
    const authUrl = await buildMicrosoftAuthUrl(
      generateOAuthState(companyId, userId, { kind }),
      kind,
    );
    return { authUrl };
  }

  async handleCallback(code: string, state: string): Promise<number> {
    const { companyId, kind } = verifyOAuthState(state);
    const connectKind: MicrosoftConnectKind =
      kind === 'personal' ? 'personal' : 'work';
    const tokens = await redeemMicrosoftCode(code, connectKind);
    if (!tokens.accessToken || !tokens.refreshToken) {
      throw new BadRequestException('Missing tokens from Microsoft');
    }
    if (!tokens.email) {
      throw new BadRequestException('Could not read Microsoft email address');
    }

    const encKey = process.env.ENCRYPTION_KEY ?? '';
    const scope = tokens.scopes.join(' ');
    const data = {
      emailAddress: tokens.email,
      accessToken: encrypt(tokens.accessToken, encKey),
      refreshToken: encrypt(tokens.refreshToken, encKey),
      tokenExpiry: tokens.expiresOn,
      msUserId: tokens.userId,
      scope,
    };
    await this.prisma.microsoftAccount.upsert({
      where: { companyId },
      create: { companyId, ...data },
      update: data,
    });

    // One provider per company — disconnect any Gmail account on this company.
    await this.prisma.gmailAccount.deleteMany({ where: { companyId } });
    this.state.bustUncompleted(companyId);

    // Start the Communications tab clean: mark already-read mail + existing chats
    // as completed (best-effort, never blocks the OAuth redirect).
    void this.markExistingAsCompletedOnConnect(companyId).catch(
      () => undefined,
    );

    return companyId;
  }

  // ── Token management ───────────────────────────────────────────────────────

  // Dedup concurrent refreshes per company. Without this, a tab that fires
  // several requests at once (emails + chats + counts) each sees the token near
  // expiry and refreshes independently; MSAL rotates the refresh token, so the
  // racing writes invalidate one another and later calls 401.
  private readonly refreshInFlight = new Map<number, Promise<string>>();

  private async getAccessToken(
    companyId: number,
    forceRefresh = false,
  ): Promise<string> {
    const record = await this.prisma.microsoftAccount.findUnique({
      where: { companyId },
    });
    if (!record) {
      throw new NotFoundException(
        'No Microsoft account connected for this company',
      );
    }
    const encKey = process.env.ENCRYPTION_KEY ?? '';

    // forceRefresh skips the fast path: Graph rejected the stored token (401), so
    // our own expiry bookkeeping can't be trusted — mint a brand-new one.
    if (
      !forceRefresh &&
      record.tokenExpiry > new Date(Date.now() + 60 * 1000)
    ) {
      return decrypt(record.accessToken, encKey);
    }

    // Access token expired (or within 60s) — refresh it, sharing one in-flight
    // refresh across concurrent callers for the same company.
    const existing = this.refreshInFlight.get(companyId);
    if (existing) return existing;

    const refreshToken = decrypt(record.refreshToken, encKey);
    // Refresh with the scopes actually granted on connect: Teams scopes for a work
    // account, base-only for a personal one (requesting Teams scopes against a
    // personal account's refresh token would fail).
    const grantedScope = (record.scope ?? '').toLowerCase();
    const hasTeams =
      grantedScope.includes('chat.readwrite') ||
      grantedScope.includes('chatmessage.send');
    const refreshScopes = scopesFor(hasTeams ? 'work' : 'personal');
    const refreshPromise = (async () => {
      const tokens = await refreshMicrosoftTokens(refreshToken, refreshScopes);
      await this.prisma.microsoftAccount.update({
        where: { companyId },
        data: {
          accessToken: encrypt(tokens.accessToken, encKey),
          tokenExpiry: tokens.expiresOn,
          // MSAL may rotate the refresh token — persist the new one if present.
          ...(tokens.refreshToken
            ? { refreshToken: encrypt(tokens.refreshToken, encKey) }
            : {}),
        },
      });
      return tokens.accessToken;
    })().finally(() => this.refreshInFlight.delete(companyId));

    this.refreshInFlight.set(companyId, refreshPromise);
    return refreshPromise;
  }

  // Run a Graph operation with the current token; on a 401 (stale/revoked token,
  // or a token that expired mid-operation), force a fresh token and retry once.
  // If the refresh itself fails (dead refresh token), the error propagates and
  // callers' catches turn it into a `needsReconnect` signal.
  private async withGraph<T>(
    companyId: number,
    fn: (token: string) => Promise<T>,
  ): Promise<T> {
    const token = await this.getAccessToken(companyId);
    try {
      return await fn(token);
    } catch (err) {
      if (err instanceof GraphError && err.status === 401) {
        const fresh = await this.getAccessToken(companyId, true);
        return await fn(fresh);
      }
      throw err;
    }
  }

  private async getSelfUserId(companyId: number): Promise<string | null> {
    const rec = await this.prisma.microsoftAccount.findUnique({
      where: { companyId },
      select: { msUserId: true },
    });
    return rec?.msUserId ?? null;
  }

  // ── Account ────────────────────────────────────────────────────────────────

  async getAccount(companyId: number): Promise<CommunicationsAccountDto> {
    const record = await this.prisma.microsoftAccount.findUnique({
      where: { companyId },
    });
    if (!record) throw new NotFoundException('No Microsoft account connected');
    const scope = (record.scope ?? '').toLowerCase();
    return {
      provider: 'MICROSOFT',
      emailAddress: record.emailAddress,
      gmailAddress: record.emailAddress, // alias for the current client
      connectedAt: record.connectedAt,
      hasChatScope:
        scope.includes('chatmessage.send') || scope.includes('chat.readwrite'),
      signatureHtml: (await this.buildDefaultSignature(companyId)).html,
    };
  }

  // Standard CYG signature, mirroring GmailService.buildDefaultSignature so the
  // compose editor is seeded identically regardless of provider.
  private async buildDefaultSignature(
    companyId: number,
  ): Promise<{ plain: string; html: string }> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        businessName: true,
        supportNumber: true,
        billing: { select: { billingEmail: true } },
      },
    });
    const sigEmail = company?.billing?.billingEmail ?? null;
    const plain = [
      company?.businessName ?? '',
      'Accounting Department',
      ...(company?.supportNumber ? [company.supportNumber] : []),
      ...(sigEmail ? [sigEmail] : []),
      '',
      'accounting managed by CYG FINANCE (https://cygfinance.com)',
    ].join('\n');
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html =
      '<div data-cyg-signature="1">' +
      [
        `<div>${esc(company?.businessName ?? '')}</div>`,
        `<div>Accounting Department</div>`,
        ...(company?.supportNumber
          ? [`<div>${esc(company.supportNumber)}</div>`]
          : []),
        ...(sigEmail ? [`<div>${esc(sigEmail)}</div>`] : []),
        '<div><br></div>',
        `<div style="font-size:0.85em">accounting managed by <a href="https://cygfinance.com">CYG FINANCE</a></div>`,
      ].join('') +
      '</div>';
    return { plain, html };
  }

  async getContacts(
    companyId: number,
  ): Promise<{ email: string; name: string }[]> {
    const record = await this.prisma.microsoftAccount.findUnique({
      where: { companyId },
      select: { emailAddress: true },
    });
    const own = (record?.emailAddress ?? '').toLowerCase();

    const byEmail = new Map<string, { email: string; name: string }>();
    const add = (a?: {
      emailAddress?: { name?: string; address?: string };
    }) => {
      const email = a?.emailAddress?.address?.trim().toLowerCase();
      if (!email || email === own) return;
      const name = a?.emailAddress?.name?.trim() ?? '';
      const existing = byEmail.get(email);
      if (!existing) byEmail.set(email, { email, name });
      else if (!existing.name && name) existing.name = name;
    };

    try {
      const [sent, inbox] = await Promise.all([
        this.withGraph(companyId, (t) =>
          graphGet<GraphList<GraphMessage>>(
            t,
            `/me/mailFolders/sentItems/messages?$top=50&$select=toRecipients,ccRecipients`,
          ),
        ),
        this.withGraph(companyId, (t) =>
          graphGet<GraphList<GraphMessage>>(
            t,
            `/me/mailFolders/inbox/messages?$top=50&$select=from,toRecipients`,
          ),
        ),
      ]);
      for (const m of sent.value) {
        (m.toRecipients ?? []).forEach(add);
        (m as { ccRecipients?: typeof m.toRecipients }).ccRecipients?.forEach(
          add,
        );
      }
      for (const m of inbox.value) {
        add(m.from);
        (m.toRecipients ?? []).forEach(add);
      }
    } catch {
      // best-effort autocomplete
    }
    return [...byEmail.values()].sort((a, b) =>
      (a.name || a.email).localeCompare(b.name || b.email),
    );
  }

  // ── Email ────────────────────────────────────────────────────────────────

  private folderFor(labelIds?: string[]): string {
    const l = labelIds ?? [];
    if (l.includes('SENT')) return 'sentItems';
    if (l.includes('SPAM')) return 'junkEmail';
    if (l.includes('TRASH')) return 'deletedItems';
    return 'inbox';
  }

  private mapEmailAttachments(
    attachments: GraphAttachment[] | undefined,
  ): EmailAttachmentDto[] {
    return (attachments ?? [])
      .filter(
        (a) => !a['@odata.type'] || a['@odata.type'].includes('fileAttachment'),
      )
      .map((a) => ({
        filename: a.name ?? 'attachment',
        mimeType: a.contentType ?? 'application/octet-stream',
        size: a.size ?? 0,
        attachmentId: a.id,
        contentId: a.contentId ?? null,
        isInline: !!a.isInline,
      }));
  }

  private mapEmailSummary(
    m: GraphMessage,
    completedSet: Set<string>,
    forwardedSet: Set<string>,
  ): EmailSummaryDto {
    return {
      id: m.id,
      threadId: m.conversationId ?? '',
      subject: m.subject ?? '',
      from: formatGraphAddress(m.from ?? m.sender),
      date: m.receivedDateTime ?? m.sentDateTime ?? '',
      snippet: m.bodyPreview ?? '',
      isRead: m.isRead ?? true,
      isCompleted: this.isMarked(completedSet, m),
      isForwarded: this.isMarked(forwardedSet, m),
      // Only real (non-inline) attachments show as chips on the list row.
      attachments: this.mapEmailAttachments(m.attachments).filter(
        (a) => !a.isInline,
      ),
    };
  }

  async getEmails(
    companyId: number,
    pageToken?: string,
    labelIds?: string[],
    q?: string,
  ): Promise<EmailListResult> {
    try {
      return await this.getEmailsCore(companyId, pageToken, labelIds, q);
    } catch (err) {
      // A rejected token/grant (401/403) or a token-refresh failure would otherwise
      // 500 and render as a misleading blank "Inbox is empty". Surface it as a
      // reconnect signal instead (mirrors getChats), and log the real Graph status.
      if (this.logGraphFailure('getEmails', companyId, err)) {
        return { messages: [], nextPageToken: null, needsReconnect: true };
      }
      throw err;
    }
  }

  private async getEmailsCore(
    companyId: number,
    pageToken?: string,
    labelIds?: string[],
    q?: string,
  ): Promise<EmailListResult> {
    const completedSet = await this.state.getCompletedSet(companyId);
    const forwardedSet = await this.state.getForwardedSet(companyId);

    // Virtual "UNCOMPLETED" folder — page over the uncompleted id list (inbox
    // minus completed) by numeric offset, mirroring the Gmail provider.
    if ((labelIds ?? []).includes('UNCOMPLETED')) {
      const ids = await this.getUncompletedEmailIds(companyId, q);
      const offset = pageToken ? parseInt(pageToken, 10) || 0 : 0;
      const slice = ids.slice(offset, offset + 50);
      const messages = await pool(slice, 5, (id) =>
        this.withGraph(companyId, (t) =>
          graphGet<GraphMessage>(
            t,
            `/me/messages/${id}?$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`,
          ),
        ).then((m) => this.mapEmailSummary(m, completedSet, forwardedSet)),
      );
      const nextPageToken =
        offset + 50 < ids.length ? String(offset + 50) : null;
      return { messages, nextPageToken };
    }

    const folder = this.folderFor(labelIds);
    const orderField =
      folder === 'sentItems' ? 'sentDateTime' : 'receivedDateTime';

    let url: string;
    if (pageToken) {
      url = pageToken; // @odata.nextLink (absolute)
    } else if (q) {
      // $search can't be combined with $orderby/$filter.
      url =
        `/me/mailFolders/${folder}/messages?$search="${encodeURIComponent(q)}"` +
        `&$top=50&$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`;
    } else if ((labelIds ?? []).includes('UNREAD')) {
      // Graph rejects $orderby combined with a $filter on isRead for messages, so
      // filter only (the folder's default order is already newest-first).
      url =
        `/me/mailFolders/${folder}/messages?$filter=isRead eq false` +
        `&$top=50&$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`;
    } else {
      url =
        `/me/mailFolders/${folder}/messages?$orderby=${orderField} desc` +
        `&$top=50&$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`;
    }

    const res = await this.withGraph(companyId, (t) =>
      graphGet<GraphList<GraphMessage>>(t, url),
    );
    await this.upgradeLegacyCompletedKeys(companyId, res.value, completedSet);
    const messages = res.value.map((m) =>
      this.mapEmailSummary(m, completedSet, forwardedSet),
    );
    return { messages, nextPageToken: res['@odata.nextLink'] ?? null };
  }

  async getEmail(
    companyId: number,
    messageId: string,
    immutable = false,
  ): Promise<EmailDetailDto> {
    // An immutable id (stored for sent forwards) only resolves when the request
    // asks for immutable ids — otherwise Graph parses it as a normal id and 404s.
    const prefer = [
      'outlook.body-content-type="html"',
      ...(immutable ? ['IdType="ImmutableId"'] : []),
    ].join(', ');
    const m = await this.withGraph(companyId, (t) =>
      graphGet<GraphMessage>(
        t,
        `/me/messages/${messageId}?$select=${EMAIL_SELECT},body&$expand=${ATTACH_EXPAND}`,
        { Prefer: prefer },
      ),
    );
    const completedSet = await this.state.getCompletedSet(companyId);
    const forwardedSet = await this.state.getForwardedSet(companyId);
    const forwardRows = await this.forwardsFor(companyId, m);
    return this.mapGraphMessageToDetail(
      m,
      completedSet,
      forwardedSet,
      forwardRows,
    );
  }

  // Fetch the whole conversation as an ordered list of email details
  // (oldest → newest), mirroring the chat-thread view. Filters messages by
  // conversationId across all folders (so inbox + sent both appear).
  async getEmailThread(
    companyId: number,
    threadId: string,
  ): Promise<EmailThreadResult> {
    // OData string literals escape a single quote by doubling it.
    const escaped = threadId.replace(/'/g, "''");
    const res = await this.withGraph(companyId, (t) =>
      graphGet<GraphList<GraphMessage>>(
        t,
        `/me/messages?$filter=conversationId eq '${encodeURIComponent(escaped)}'` +
          `&$top=50&$select=${EMAIL_SELECT},body&$expand=${ATTACH_EXPAND}`,
        { Prefer: 'outlook.body-content-type="html"' },
      ),
    );
    const completedSet = await this.state.getCompletedSet(companyId);
    const forwardedSet = await this.state.getForwardedSet(companyId);

    // Graph rejects $orderby alongside a $filter on conversationId, so sort here.
    const sorted = [...res.value].sort((a, b) => {
      const da = a.receivedDateTime ?? a.sentDateTime ?? '';
      const db = b.receivedDateTime ?? b.sentDateTime ?? '';
      return da < db ? -1 : da > db ? 1 : 0;
    });

    const messages = await Promise.all(
      sorted.map(async (m) => {
        const forwardRows = await this.forwardsFor(companyId, m);
        return this.mapGraphMessageToDetail(
          m,
          completedSet,
          forwardedSet,
          forwardRows,
        );
      }),
    );
    return { messages };
  }

  // Maps a Graph message (with body + attachments selected) to the shared
  // EmailDetailDto shape. Shared by getEmail and getEmailThread.
  private mapGraphMessageToDetail(
    m: GraphMessage,
    completedSet: Set<string>,
    forwardedSet: Set<string>,
    forwardRows: {
      recipient: string | null;
      forwardedAt: Date;
      sentMessageId: string | null;
    }[],
  ): EmailDetailDto {
    const isHtml = (m.body?.contentType ?? '').toLowerCase() === 'html';
    return {
      id: m.id,
      threadId: m.conversationId ?? '',
      messageId: this.stateKey(m),
      subject: m.subject ?? '',
      from: formatGraphAddress(m.from ?? m.sender),
      to: formatGraphAddressList(m.toRecipients),
      date: m.receivedDateTime ?? m.sentDateTime ?? '',
      snippet: m.bodyPreview ?? '',
      bodyHtml: isHtml ? (m.body?.content ?? null) : null,
      bodyText: !isHtml ? (m.body?.content ?? null) : null,
      attachments: this.mapEmailAttachments(m.attachments),
      isRead: m.isRead ?? true,
      isCompleted: this.isMarked(completedSet, m),
      isForwarded: this.isMarked(forwardedSet, m),
      forwards: forwardRows.map((r) => ({
        to: r.recipient ?? '',
        at: r.forwardedAt.toISOString(),
        messageId: r.sentMessageId ?? null,
      })),
    };
  }

  async getEmailAttachment(
    companyId: number,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    return this.withGraph(companyId, (t) =>
      graphGetBinary(
        t,
        `/me/messages/${messageId}/attachments/${attachmentId}/$value`,
      ),
    );
  }

  async markAsRead(companyId: number, messageId: string): Promise<void> {
    const token = await this.getAccessToken(companyId);
    await graphPatch(token, `/me/messages/${messageId}`, { isRead: true });
  }

  async markAsUnread(companyId: number, messageId: string): Promise<void> {
    const token = await this.getAccessToken(companyId);
    await graphPatch(token, `/me/messages/${messageId}`, { isRead: false });
  }

  private parseRecipients(
    list: string | undefined,
  ): { emailAddress: { address: string } }[] {
    return (list ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address } }));
  }

  private buildGraphMessage(
    dto: SendEmailDto,
    attachments: UploadedFile[],
  ): Record<string, unknown> {
    return {
      subject: dto.subject ?? '',
      body: {
        contentType: dto.bodyHtml ? 'html' : 'text',
        content: dto.bodyHtml ?? dto.body,
      },
      toRecipients: this.parseRecipients(dto.to),
      ccRecipients: this.parseRecipients(dto.cc),
      attachments: attachments.map((f) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: f.originalname,
        contentType: f.mimetype,
        contentBytes: f.buffer.toString('base64'),
      })),
    };
  }

  /**
   * Adds one file to an existing draft. Attachments are a navigation property,
   * so a PATCH of the draft cannot carry them — they must be POSTed separately.
   * Graph caps the inline `contentBytes` form at 3 MB; anything larger needs a
   * chunked upload session (multer lets 15 MB through, so this is reachable).
   */
  private async addDraftAttachment(
    token: string,
    draftId: string,
    f: UploadedFile,
  ): Promise<void> {
    const INLINE_MAX = 3 * 1024 * 1024;
    if (f.buffer.length <= INLINE_MAX) {
      await graphPost(token, `/me/messages/${draftId}/attachments`, {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: f.originalname,
        contentType: f.mimetype,
        contentBytes: f.buffer.toString('base64'),
      });
      return;
    }

    const session = await graphPost<{ uploadUrl?: string }>(
      token,
      `/me/messages/${draftId}/attachments/createUploadSession`,
      {
        AttachmentItem: {
          attachmentType: 'file',
          name: f.originalname,
          size: f.buffer.length,
          contentType: f.mimetype,
        },
      },
    );
    const uploadUrl = session?.uploadUrl;
    if (!uploadUrl) {
      throw new Error(`Graph returned no uploadUrl for "${f.originalname}"`);
    }
    // Chunks must be a multiple of 320 KiB; the upload URL is pre-authorized, so
    // it takes no Authorization header.
    const CHUNK = 320 * 1024 * 10;
    const total = f.buffer.length;
    for (let start = 0; start < total; start += CHUNK) {
      const end = Math.min(start + CHUNK, total) - 1;
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        // Content-Length is set by the runtime; setting it here is rejected.
        headers: { 'Content-Range': `bytes ${start}-${end}/${total}` },
        body: new Uint8Array(f.buffer.subarray(start, end + 1)),
      });
      if (!res.ok) {
        throw new Error(
          `Attachment upload failed for "${f.originalname}" (${res.status})`,
        );
      }
    }
  }

  /**
   * Builds a reply/forward draft through Graph's own `createReply` /
   * `createForward`, which is the ONLY way to get correct threading: Graph
   * rejects `internetMessageHeaders` that don't start with `x-`, so In-Reply-To
   * and References cannot be set on a plain sendMail. The returned draft already
   * carries the right conversationId, those headers, and the quoted original.
   *
   * Returns the sent message's id, or null when the draft couldn't be created
   * (original deleted/moved). Callers decide how to degrade: a reply falls back
   * to an unthreaded sendMail, a forward fails loudly — see `sendEmail`.
   */
  private async sendViaDraft(
    companyId: number,
    token: string,
    sourceId: string,
    action: 'createReply' | 'createForward',
    dto: SendEmailDto,
    attachments: UploadedFile[],
  ): Promise<string | null> {
    let draft: GraphMessage | null;
    try {
      draft = await graphPost<GraphMessage>(
        token,
        `/me/messages/${sourceId}/${action}`,
        {},
        // Immutable so the id still resolves after the draft moves to Sent.
        { Prefer: 'IdType="ImmutableId", outlook.body-content-type="html"' },
      );
    } catch (err) {
      // The original may have been deleted or moved out from under us. Don't
      // hard-fail the send — the caller degrades to an unthreaded sendMail.
      this.logger.warn(
        `${action} failed for company ${companyId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
    if (!draft?.id) return null;

    const userHtml = dto.bodyHtml ?? textToHtml(dto.body);
    await graphPatch(
      token,
      `/me/messages/${draft.id}`,
      {
        subject: dto.subject ?? draft.subject ?? '',
        body: {
          contentType: 'html',
          content: insertAboveQuote(userHtml, draft.body?.content ?? ''),
        },
        // createReply/createForward pre-fill recipients from the original;
        // overwrite with what the user actually had in the compose form.
        toRecipients: this.parseRecipients(dto.to),
        ccRecipients: this.parseRecipients(dto.cc),
      },
      { Prefer: 'IdType="ImmutableId"' },
    );

    for (const f of attachments) {
      await this.addDraftAttachment(token, draft.id, f);
    }

    await graphPost(token, `/me/messages/${draft.id}/send`, {});
    return draft.id;
  }

  async sendEmail(
    companyId: number,
    dto: SendEmailDto,
    attachments: UploadedFile[] = [],
  ): Promise<void> {
    const token = await this.getAccessToken(companyId);
    const message = this.buildGraphMessage(dto, attachments);

    // Reply — thread it through Graph's createReply draft.
    if (dto.replyToMessageId) {
      const sentId = await this.sendViaDraft(
        companyId,
        token,
        dto.replyToMessageId,
        'createReply',
        dto,
        attachments,
      );
      if (sentId) return;
      // Fall through: unthreaded, but the reply still gets sent.
    }

    if (dto.forwardedFrom) {
      // Prefer Graph's own createForward: it carries the original's formatting,
      // its inline `cid:` images and its attachments into the draft — none of
      // which the client's sanitized quote can reproduce. The client skips its
      // own quoting for Outlook so the original isn't included twice.
      const sentId = await this.sendViaDraft(
        companyId,
        token,
        dto.forwardedFrom,
        'createForward',
        dto,
        attachments,
      );
      if (!sentId) {
        // No silent fallback here: the client deliberately stops quoting for
        // Outlook, so `message` holds only the user's note + signature. Sending
        // that would deliver a "forward" with none of the forwarded content.
        // Fail loudly instead so the user can retry or copy the text out.
        throw new BadRequestException(
          "Couldn't load the original message to forward. It may have been " +
            'moved or deleted in Outlook — reopen the message and try again.',
        );
      }
      await this.state.recordForward(
        companyId,
        // Keyed like every other shared-state row; `sentId` stays a Graph
        // resource id because the UI opens the sent copy by it.
        await this.stateKeyForId(companyId, dto.forwardedFrom),
        dto.to,
        sentId,
      );
      return;
    }

    await graphPost(token, '/me/sendMail', {
      message,
      saveToSentItems: true,
    });
  }

  // ── Chat (Teams) ───────────────────────────────────────────────────────────

  async getChats(companyId: number): Promise<ChatListResult> {
    const empty = (
      chatStatus: ChatListResult['chatStatus'],
      needsReconnect = false,
    ): ChatListResult => ({
      messages: [],
      needsReconnect,
      chatStatus,
      senderNamesUnavailable: null,
      nextCursor: null,
      hasMore: false,
    });

    let selfId: string | null;
    try {
      // Validate the account/token up front so a dead refresh token maps to the
      // reconnect banner (not the generic chat-error path below).
      await this.getAccessToken(companyId);
      selfId = await this.getSelfUserId(companyId);
    } catch (err) {
      this.logGraphFailure('getChats(token)', companyId, err);
      return empty('needs_reconnect', true);
    }

    try {
      const readSet = await this.state.getReadSet(companyId);
      const completedSet = await this.state.getCompletedSet(companyId);
      const chatsRes = await this.withGraph(companyId, (t) =>
        graphGet<GraphList<GraphChat>>(
          t,
          `/me/chats?$expand=members&$top=${SPACE_CAP}`,
        ),
      );
      const chats = chatsRes.value;
      if (chats.length === 0) return empty('no_spaces');

      const perChat = await pool(chats, 4, async (chat) => {
        try {
          const msgs = await this.withGraph(companyId, (t) =>
            graphGet<GraphList<GraphChatMessage>>(
              t,
              `/me/chats/${chat.id}/messages?$top=${MSG_PER_SPACE}`,
            ),
          );
          return { chat, messages: msgs.value };
        } catch {
          return { chat, messages: [] as GraphChatMessage[] };
        }
      });

      const rows: ChatListResult['messages'] = [];
      for (const { chat, messages } of perChat) {
        const spaceName = chatDisplayName(chat, selfId);
        const spaceType = chatSpaceType(chat.chatType);
        for (const m of messages) {
          if (m.messageType && m.messageType !== 'message') continue; // system events
          const senderId = m.from?.user?.id;
          if (senderId && senderId === selfId) continue; // hide self-sent
          const text = htmlToText(m.body?.content);
          if (!text && !(m.attachments?.length ?? 0)) continue;
          const id = teamsStateId(chat.id, m.id);
          rows.push({
            id,
            spaceId: chat.id,
            spaceName,
            spaceType,
            sender: m.from?.user?.displayName ?? 'Unknown',
            text,
            createTime: m.createdDateTime ?? '',
            lastUpdateTime: m.lastModifiedDateTime ?? m.createdDateTime ?? '',
            quotedMessageName: null,
            isRead: readSet.has(id),
            isCompleted: completedSet.has(id),
            hasAttachments: (m.attachments?.length ?? 0) > 0,
          });
        }
      }
      rows.sort((a, b) => (a.createTime < b.createTime ? 1 : -1));
      return {
        messages: rows,
        needsReconnect: false,
        chatStatus: rows.length ? 'ok' : 'no_spaces',
        senderNamesUnavailable: null,
        nextCursor: null,
        hasMore: false,
      };
    } catch (err) {
      this.logGraphFailure('getChats', companyId, err);
      if (err instanceof GraphError) {
        // No Teams/O365 license → reconnecting can't fix it; report distinctly.
        if (err.status === 403 && /license/i.test(err.message)) {
          return empty('no_license');
        }
        if (err.status === 401 || err.status === 403) {
          return empty('chat_disabled', true);
        }
      }
      return empty('error');
    }
  }

  async getChatThread(
    companyId: number,
    spaceId: string,
    pageToken?: string,
  ): Promise<ChatThreadResult> {
    let selfId: string | null;
    try {
      await this.getAccessToken(companyId);
      selfId = await this.getSelfUserId(companyId);
    } catch {
      return { messages: [], nextPageToken: null, needsReconnect: true };
    }

    try {
      const chat = await this.withGraph(companyId, (t) =>
        graphGet<GraphChat>(t, `/me/chats/${spaceId}?$expand=members`),
      );
      const res = await this.withGraph(companyId, (t) =>
        graphGet<GraphList<GraphChatMessage>>(
          t,
          pageToken ?? `/me/chats/${spaceId}/messages?$top=50`,
        ),
      );
      const spaceName = chatDisplayName(chat, selfId);
      const spaceType = chatSpaceType(chat.chatType);
      const messages = res.value
        .filter((m) => !m.messageType || m.messageType === 'message')
        .map((m) => ({
          id: teamsStateId(spaceId, m.id),
          spaceId,
          spaceName,
          spaceType,
          sender: m.from?.user?.displayName ?? 'Unknown',
          text: htmlToText(m.body?.content),
          createTime: m.createdDateTime ?? '',
          lastUpdateTime: m.lastModifiedDateTime ?? m.createdDateTime ?? '',
          quotedMessageName: null,
          isOwn: !!m.from?.user?.id && m.from.user.id === selfId,
          attachments: (m.attachments ?? [])
            .filter((a) => a.contentUrl)
            .map((a) => ({
              name: a.name ?? 'attachment',
              contentName: a.name ?? 'attachment',
              contentType: a.contentType ?? 'application/octet-stream',
              resourceName: null,
              driveFileId: null,
              thumbnailUri: a.thumbnailUrl ?? null,
              downloadUri: a.contentUrl ?? null,
              source: 'sharepoint',
            })),
        }))
        .reverse(); // Graph returns newest-first; the thread renders oldest→newest.
      return {
        messages,
        nextPageToken: res['@odata.nextLink'] ?? null,
        spaceName,
        spaceType,
      };
    } catch {
      return { messages: [], nextPageToken: null, needsReconnect: true };
    }
  }

  async getChatAttachment(
    companyId: number,
    resourceName: string,
  ): Promise<Buffer> {
    // resourceName is a Graph hosted-content path, e.g.
    // "chats/{id}/messages/{id}/hostedContents/{id}".
    return this.withGraph(companyId, (t) =>
      graphGetBinary(t, `/${resourceName}/$value`),
    );
  }

  async sendChatMessage(
    companyId: number,
    dto: SendChatMessageDto,
  ): Promise<{
    id: string;
    spaceId: string;
    sender: string;
    text: string;
    createTime: string;
    lastUpdateTime: string;
    quotedMessageName: string | null;
  }> {
    const token = await this.getAccessToken(companyId);
    let created: GraphChatMessage | null = null;
    try {
      created = await graphPost<GraphChatMessage>(
        token,
        `/me/chats/${dto.spaceId}/messages`,
        { body: { contentType: 'html', content: dto.text } },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to send message';
      throw new BadRequestException(msg);
    }
    const now = new Date().toISOString();
    return {
      id: created?.id
        ? teamsStateId(dto.spaceId, created.id)
        : teamsStateId(dto.spaceId, now),
      spaceId: dto.spaceId,
      sender: 'You',
      text: dto.text,
      createTime: created?.createdDateTime ?? now,
      lastUpdateTime: created?.lastModifiedDateTime ?? now,
      quotedMessageName: null,
    };
  }

  // ── Shared inbox state (delegated) ─────────────────────────────────────────

  async markChatRead(companyId: number, messageId: string): Promise<void> {
    await this.state.markChatRead(companyId, messageId);
  }
  async markChatUnread(companyId: number, messageId: string): Promise<void> {
    await this.state.markChatUnread(companyId, messageId);
  }
  // The client only knows the Graph restId the row was rendered with, so both
  // writes resolve it to the stable state key first (see `stateKey`).
  async markComplete(companyId: number, messageId: string): Promise<void> {
    await this.state.markComplete(
      companyId,
      await this.stateKeyForId(companyId, messageId),
    );
  }
  async markUncomplete(companyId: number, messageId: string): Promise<void> {
    const key = await this.stateKeyForId(companyId, messageId);
    await this.state.markUncomplete(companyId, key);
    // Older rows may still be keyed on the restId (pre-migration, or written
    // while the Graph lookup was failing). Clear that too so un-completing is
    // never a no-op the user has to repeat.
    if (key !== messageId) {
      await this.state.markUncomplete(companyId, messageId);
    }
  }

  // ── Counts ───────────────────────────────────────────────────────────────

  async getUnreadCount(companyId: number): Promise<{ count: number }> {
    let emailUnread = 0;
    try {
      const folder = await this.withGraph(companyId, (t) =>
        graphGet<{ unreadItemCount?: number }>(
          t,
          `/me/mailFolders/inbox?$select=unreadItemCount`,
        ),
      );
      emailUnread = folder.unreadItemCount ?? 0;
    } catch {
      // ignore
    }
    let chatUnread = 0;
    try {
      const chats = await this.getChats(companyId);
      chatUnread = chats.messages.filter((m) => !m.isRead).length;
    } catch {
      // ignore chat failures
    }
    return { count: emailUnread + chatUnread };
  }

  async getUncompletedCount(companyId: number): Promise<{ count: number }> {
    return this.state.getUncompletedCount(companyId, () =>
      this.computeUncompletedCount(companyId),
    );
  }

  private async computeUncompletedCount(companyId: number): Promise<number> {
    let emailUncompleted = 0;
    try {
      emailUncompleted = (await this.getUncompletedEmailIds(companyId)).length;
    } catch {
      // Unreadable mailbox (e.g. unlicensed account 401/403) — don't 500 the
      // counts endpoint; treat as zero.
    }
    let chatUncompleted = 0;
    try {
      const chats = await this.getChats(companyId);
      chatUncompleted = chats.messages.filter((m) => !m.isCompleted).length;
    } catch {
      // ignore chat failures — still return the email count
    }
    return emailUncompleted + chatUncompleted;
  }

  private async getUncompletedEmailIds(
    companyId: number,
    q?: string,
  ): Promise<string[]> {
    return this.state.getCachedEmailIds(companyId, q, async () => {
      // Both ids are needed: the state key decides what's completed, but the
      // returned list is fetched by restId later (getEmailsCore).
      const inbox: { id: string; internetMessageId?: string }[] = [];
      const MAX_PAGES = 40;
      let url =
        `/me/mailFolders/inbox/messages?$select=id,internetMessageId&$top=500` +
        (q
          ? `&$search="${encodeURIComponent(q)}"`
          : `&$orderby=receivedDateTime desc`);
      for (let page = 0; page < MAX_PAGES; page++) {
        // Per-page withGraph: a token that expires partway through this long scan
        // (up to 40×500) self-heals via a forced refresh + retry of that page.
        const res: GraphList<{ id: string; internetMessageId?: string }> =
          await this.withGraph(companyId, (t) => graphGet(t, url));
        inbox.push(...res.value);
        const next = res['@odata.nextLink'];
        if (!next) break;
        url = next;
      }
      // Completed email ids don't carry the Teams prefix; drop chat ids.
      const completedSet = await this.state.getCompletedSet(companyId);
      await this.upgradeLegacyCompletedKeys(companyId, inbox, completedSet);
      return inbox
        .filter(
          (m) =>
            !this.isMarked(completedSet, m) && !m.id.startsWith(TEAMS_PREFIX),
        )
        .map((m) => m.id);
    });
  }

  async getUncompletedCounts(): Promise<Record<number, number>> {
    const accounts = await this.prisma.microsoftAccount.findMany({
      select: { companyId: true },
    });
    const ids = accounts.map((a) => a.companyId);
    const counts: Record<number, number> = {};
    await pool(ids, 4, async (companyId) => {
      try {
        const { count } = await this.getUncompletedCount(companyId);
        counts[companyId] = count;
      } catch (err) {
        console.error(
          `[microsoft] uncompleted count failed for company ${companyId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });
    return counts;
  }

  // ── Disconnect ───────────────────────────────────────────────────────────

  async disconnect(companyId: number): Promise<void> {
    await this.prisma.microsoftAccount
      .delete({ where: { companyId } })
      .catch(() => undefined);
    this.state.bustUncompleted(companyId);
  }

  // ── Connect sweep ──────────────────────────────────────────────────────────

  private async markExistingAsCompletedOnConnect(
    companyId: number,
  ): Promise<void> {
    // Already-read inbox emails → completed. Flushed under the state key
    // (Message-ID), not the restId, so the rows survive a later folder move.
    const readKeys: string[] = [];
    let url = `/me/mailFolders/inbox/messages?$select=id,internetMessageId&$filter=isRead eq true&$top=500`;
    for (let page = 0; page < 40; page++) {
      const res: GraphList<{ id: string; internetMessageId?: string }> =
        await this.withGraph(companyId, (t) => graphGet(t, url));
      for (const m of res.value) readKeys.push(this.stateKey(m));
      const next = res['@odata.nextLink'];
      if (!next) break;
      url = next;
    }
    const emailWritten = await this.state.flushCompleted(companyId, readKeys);

    // All currently-visible chat messages → completed.
    let chatWritten = 0;
    try {
      const chats = await this.getChats(companyId);
      const chatIds = chats.messages.map((m) => m.id);
      chatWritten = await this.state.flushCompleted(companyId, chatIds);
    } catch {
      // ignore chat failures
    }

    this.state.bustUncompleted(companyId);
    console.log(
      `[Microsoft] Connect sweep for company ${companyId}: marked ${emailWritten} emails + ${chatWritten} chat messages as completed.`,
    );
  }
}
