import {
  Injectable,
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
} from '../communications/communications.types.js';
import type { CommunicationsProvider } from '../communications/provider.interface.js';
import { SendEmailDto } from '../gmail/dto/send-email.dto.js';
import { SendChatMessageDto } from '../gmail/dto/send-chat-message.dto.js';
import {
  buildMicrosoftAuthUrl,
  redeemMicrosoftCode,
  refreshMicrosoftTokens,
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
const ATTACH_EXPAND =
  'attachments($select=id,name,contentType,size,isInline,contentId)';

@Injectable()
export class MicrosoftService implements CommunicationsProvider {
  readonly providerKind = 'MICROSOFT' as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MessageStateService,
  ) {}

  // ── OAuth ────────────────────────────────────────────────────────────────

  async generateAuthUrl(
    companyId: number,
    userId: number,
  ): Promise<{ authUrl: string }> {
    const authUrl = await buildMicrosoftAuthUrl(
      generateOAuthState(companyId, userId),
    );
    return { authUrl };
  }

  async handleCallback(code: string, state: string): Promise<number> {
    const { companyId } = verifyOAuthState(state);
    const tokens = await redeemMicrosoftCode(code);
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
    void this.markExistingAsCompletedOnConnect(companyId).catch(() => undefined);

    return companyId;
  }

  // ── Token management ───────────────────────────────────────────────────────

  private async getAccessToken(companyId: number): Promise<string> {
    const record = await this.prisma.microsoftAccount.findUnique({
      where: { companyId },
    });
    if (!record) {
      throw new NotFoundException(
        'No Microsoft account connected for this company',
      );
    }
    const encKey = process.env.ENCRYPTION_KEY ?? '';

    if (record.tokenExpiry > new Date(Date.now() + 60 * 1000)) {
      return decrypt(record.accessToken, encKey);
    }

    // Access token expired (or within 60s) — refresh it.
    const refreshToken = decrypt(record.refreshToken, encKey);
    const tokens = await refreshMicrosoftTokens(refreshToken);
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
    const token = await this.getAccessToken(companyId);
    const record = await this.prisma.microsoftAccount.findUnique({
      where: { companyId },
      select: { emailAddress: true },
    });
    const own = (record?.emailAddress ?? '').toLowerCase();

    const byEmail = new Map<string, { email: string; name: string }>();
    const add = (a?: { emailAddress?: { name?: string; address?: string } }) => {
      const email = a?.emailAddress?.address?.trim().toLowerCase();
      if (!email || email === own) return;
      const name = a?.emailAddress?.name?.trim() ?? '';
      const existing = byEmail.get(email);
      if (!existing) byEmail.set(email, { email, name });
      else if (!existing.name && name) existing.name = name;
    };

    try {
      const [sent, inbox] = await Promise.all([
        graphGet<GraphList<GraphMessage>>(
          token,
          `/me/mailFolders/sentItems/messages?$top=50&$select=toRecipients,ccRecipients`,
        ),
        graphGet<GraphList<GraphMessage>>(
          token,
          `/me/mailFolders/inbox/messages?$top=50&$select=from,toRecipients`,
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
        (a) =>
          !a['@odata.type'] ||
          a['@odata.type'].includes('fileAttachment'),
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
      subject: m.subject ?? '',
      from: formatGraphAddress(m.from ?? m.sender),
      date: m.receivedDateTime ?? m.sentDateTime ?? '',
      snippet: m.bodyPreview ?? '',
      isRead: m.isRead ?? true,
      isCompleted: completedSet.has(m.id),
      isForwarded: forwardedSet.has(m.id),
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
    const token = await this.getAccessToken(companyId);
    const completedSet = await this.state.getCompletedSet(companyId);
    const forwardedSet = await this.state.getForwardedSet(companyId);

    // Virtual "UNCOMPLETED" folder — page over the uncompleted id list (inbox
    // minus completed) by numeric offset, mirroring the Gmail provider.
    if ((labelIds ?? []).includes('UNCOMPLETED')) {
      const ids = await this.getUncompletedEmailIds(companyId, q);
      const offset = pageToken ? parseInt(pageToken, 10) || 0 : 0;
      const slice = ids.slice(offset, offset + 50);
      const messages = await pool(slice, 5, (id) =>
        graphGet<GraphMessage>(
          token,
          `/me/messages/${id}?$select=${EMAIL_SELECT}&$expand=${ATTACH_EXPAND}`,
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

    const res = await graphGet<GraphList<GraphMessage>>(token, url);
    const messages = res.value.map((m) =>
      this.mapEmailSummary(m, completedSet, forwardedSet),
    );
    return { messages, nextPageToken: res['@odata.nextLink'] ?? null };
  }

  async getEmail(companyId: number, messageId: string): Promise<EmailDetailDto> {
    const token = await this.getAccessToken(companyId);
    const m = await graphGet<GraphMessage>(
      token,
      `/me/messages/${messageId}?$select=${EMAIL_SELECT},body&$expand=${ATTACH_EXPAND}`,
      { Prefer: 'outlook.body-content-type="html"' },
    );
    const completedSet = await this.state.getCompletedSet(companyId);
    const forwardedSet = await this.state.getForwardedSet(companyId);
    const forwardRows = await this.state.getForwards(companyId, messageId);
    const isHtml = (m.body?.contentType ?? '').toLowerCase() === 'html';

    return {
      id: m.id,
      threadId: m.conversationId ?? '',
      messageId: m.internetMessageId ?? m.id,
      subject: m.subject ?? '',
      from: formatGraphAddress(m.from ?? m.sender),
      to: formatGraphAddressList(m.toRecipients),
      date: m.receivedDateTime ?? m.sentDateTime ?? '',
      snippet: m.bodyPreview ?? '',
      bodyHtml: isHtml ? (m.body?.content ?? null) : null,
      bodyText: !isHtml ? (m.body?.content ?? null) : null,
      attachments: this.mapEmailAttachments(m.attachments),
      isRead: m.isRead ?? true,
      isCompleted: completedSet.has(m.id),
      isForwarded: forwardedSet.has(m.id),
      forwards: forwardRows.map((r) => ({
        to: r.recipient ?? '',
        at: r.forwardedAt.toISOString(),
      })),
    };
  }

  async getEmailAttachment(
    companyId: number,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const token = await this.getAccessToken(companyId);
    return graphGetBinary(
      token,
      `/me/messages/${messageId}/attachments/${attachmentId}/$value`,
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

  async sendEmail(
    companyId: number,
    dto: SendEmailDto,
    attachments: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
      size: number;
    }> = [],
  ): Promise<void> {
    const token = await this.getAccessToken(companyId);
    const message = {
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
    await graphPost(token, '/me/sendMail', {
      message,
      saveToSentItems: true,
    });
    if (dto.forwardedFrom) {
      await this.state.recordForward(companyId, dto.forwardedFrom, dto.to);
    }
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

    let token: string;
    let selfId: string | null;
    try {
      token = await this.getAccessToken(companyId);
      selfId = await this.getSelfUserId(companyId);
    } catch {
      return empty('needs_reconnect', true);
    }

    try {
      const readSet = await this.state.getReadSet(companyId);
      const completedSet = await this.state.getCompletedSet(companyId);
      const chatsRes = await graphGet<GraphList<GraphChat>>(
        token,
        `/me/chats?$expand=members&$top=${SPACE_CAP}`,
      );
      const chats = chatsRes.value;
      if (chats.length === 0) return empty('no_spaces');

      const perChat = await pool(chats, 4, async (chat) => {
        try {
          const msgs = await graphGet<GraphList<GraphChatMessage>>(
            token,
            `/me/chats/${chat.id}/messages?$top=${MSG_PER_SPACE}`,
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
      if (err instanceof GraphError && (err.status === 401 || err.status === 403)) {
        return empty('chat_disabled', true);
      }
      return empty('error');
    }
  }

  async getChatThread(
    companyId: number,
    spaceId: string,
    pageToken?: string,
  ): Promise<ChatThreadResult> {
    let token: string;
    let selfId: string | null;
    try {
      token = await this.getAccessToken(companyId);
      selfId = await this.getSelfUserId(companyId);
    } catch {
      return { messages: [], nextPageToken: null, needsReconnect: true };
    }

    try {
      const chat = await graphGet<GraphChat>(
        token,
        `/me/chats/${spaceId}?$expand=members`,
      );
      const res = await graphGet<GraphList<GraphChatMessage>>(
        token,
        pageToken ?? `/me/chats/${spaceId}/messages?$top=50`,
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
    const token = await this.getAccessToken(companyId);
    // resourceName is a Graph hosted-content path, e.g.
    // "chats/{id}/messages/{id}/hostedContents/{id}".
    return graphGetBinary(token, `/${resourceName}/$value`);
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
  async markComplete(companyId: number, messageId: string): Promise<void> {
    await this.state.markComplete(companyId, messageId);
  }
  async markUncomplete(companyId: number, messageId: string): Promise<void> {
    await this.state.markUncomplete(companyId, messageId);
  }

  // ── Counts ───────────────────────────────────────────────────────────────

  async getUnreadCount(companyId: number): Promise<{ count: number }> {
    const token = await this.getAccessToken(companyId);
    let emailUnread = 0;
    try {
      const folder = await graphGet<{ unreadItemCount?: number }>(
        token,
        `/me/mailFolders/inbox?$select=unreadItemCount`,
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
    const emailUncompleted = (await this.getUncompletedEmailIds(companyId))
      .length;
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
      const token = await this.getAccessToken(companyId);
      const inboxIds: string[] = [];
      const MAX_PAGES = 40;
      let url =
        `/me/mailFolders/inbox/messages?$select=id&$top=500` +
        (q ? `&$search="${encodeURIComponent(q)}"` : `&$orderby=receivedDateTime desc`);
      for (let page = 0; page < MAX_PAGES; page++) {
        const res: GraphList<{ id: string }> = await graphGet(token, url);
        for (const m of res.value) inboxIds.push(m.id);
        const next = res['@odata.nextLink'];
        if (!next) break;
        url = next;
      }
      // Completed email ids don't carry the Teams prefix; drop chat ids.
      const completedSet = await this.state.getCompletedSet(companyId);
      return inboxIds.filter(
        (id) => !completedSet.has(id) && !id.startsWith(TEAMS_PREFIX),
      );
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
    const token = await this.getAccessToken(companyId);

    // Already-read inbox emails → completed.
    const readIds: string[] = [];
    let url =
      `/me/mailFolders/inbox/messages?$select=id&$filter=isRead eq true&$top=500`;
    for (let page = 0; page < 40; page++) {
      const res: GraphList<{ id: string }> = await graphGet(token, url);
      for (const m of res.value) readIds.push(m.id);
      const next = res['@odata.nextLink'];
      if (!next) break;
      url = next;
    }
    const emailWritten = await this.state.flushCompleted(companyId, readIds);

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
