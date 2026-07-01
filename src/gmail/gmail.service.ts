import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { google } from 'googleapis';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Subject } from 'rxjs';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { SendEmailDto } from './dto/send-email.dto.js';
import { SendChatMessageDto } from './dto/send-chat-message.dto.js';

// Shape of a single Google Chat message returned to the client.
export interface ChatMessageDto {
  id: string;
  spaceId: string;
  spaceName: string;
  spaceType: string;
  sender: string;
  text: string;
  createTime: string;
  // Needed to quote this message via the Chat API (quotedMessageMetadata).
  lastUpdateTime: string;
  // Resource name of the message THIS message quotes (if any), so the client
  // can render a quoted preview. null when this message doesn't quote anything.
  quotedMessageName?: string | null;
  isOwn?: boolean;
}

// ─── Encryption (mirrors companies.service.ts) ───────────────────────────────

const ALGORITHM = 'aes-256-cbc';

function encrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex'),
  );
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Scopes that actually permit SENDING a chat message. Note `chat.messages.readonly`
// is NOT here — older accounts were connected with the read-only scope, and a
// substring check (`scope.includes('chat.messages')`) wrongly matched it.
const CHAT_SEND_SCOPES = [
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.messages.create',
];

// True only when the granted scope string contains an exact chat *send* scope token.
function grantsChatSend(scope: string | null | undefined): boolean {
  const tokens = (scope ?? '').split(/\s+/);
  return CHAT_SEND_SCOPES.some((s) => tokens.includes(s));
}

function getCallbackUrl(): string {
  return `${process.env.CALLBACK_BASE_URL ?? 'http://localhost:3000'}/api/gmail/callback`;
}

function makeOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_API_SECRET,
    getCallbackUrl(),
  );
}

function generateState(companyId: number, userId: number): string {
  const payload = Buffer.from(
    JSON.stringify({ companyId, userId, ts: Date.now() }),
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', process.env.JWT_SECRET ?? 'secret')
    .update(payload)
    .digest('hex');
  return `${payload}.${sig}`;
}

function verifyState(state: string): { companyId: number; userId: number } {
  const dotIdx = state.lastIndexOf('.');
  if (dotIdx === -1) throw new UnauthorizedException('Invalid state');
  const payload = state.slice(0, dotIdx);
  const sig = state.slice(dotIdx + 1);
  const expected = crypto
    .createHmac('sha256', process.env.JWT_SECRET ?? 'secret')
    .update(payload)
    .digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (
    sigBuf.length !== expBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expBuf)
  ) {
    throw new UnauthorizedException('Invalid state signature');
  }
  const parsed = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as {
    companyId: number;
    userId: number;
    ts: number;
  };
  if (Date.now() - parsed.ts > 10 * 60 * 1000) {
    throw new UnauthorizedException('State expired');
  }
  return { companyId: parsed.companyId, userId: parsed.userId };
}

// Decode the `sub` claim from a Google id_token (JWT) without verifying the
// signature — the token came directly from Google's token endpoint over TLS.
// Returns the account's own Chat user id, or null if it can't be read.
function decodeIdTokenSub(idToken?: string | null): string | null {
  if (!idToken) return null;
  try {
    const payloadSeg = idToken.split('.')[1];
    if (!payloadSeg) return null;
    const json = Buffer.from(payloadSeg, 'base64url').toString('utf8');
    const payload = JSON.parse(json) as { sub?: string };
    return payload.sub ?? null;
  } catch {
    return null;
  }
}

// Walk Gmail message parts to find a specific mimeType
function extractPart(
  payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] },
  mimeType: string,
): string | null {
  if (!payload) return null;
  if (payload.mimeType === mimeType && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf8');
  }
  if (payload.parts) {
    for (const part of payload.parts as (typeof payload)[]) {
      const found = extractPart(part, mimeType);
      if (found) return found;
    }
  }
  return null;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class GmailService {
  // SSE subjects keyed by a unique client id
  private readonly sseClients = new Map<
    string,
    { companyId: number; subject: Subject<{ data: string }> }
  >();

  constructor(private readonly prisma: PrismaService) {}

  // ── OAuth ────────────────────────────────────────────────────────────────

  generateAuthUrl(companyId: number, userId: number): { authUrl: string } {
    const oauth2Client = makeOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // force re-consent so newly-added scopes are granted on reconnect
      include_granted_scopes: true, // incremental auth — keep previously granted scopes
      scope: [
        // Gmail: read, modify labels (read/unread), and send/reply (modify covers send)
        'https://www.googleapis.com/auth/gmail.modify',
        // Account identity (the connected mailbox address)
        'https://www.googleapis.com/auth/userinfo.email',
        // OpenID — guarantees an id_token with the `sub` claim (= the account's own
        // Chat user id, used to hide self-sent messages from the inbox)
        'openid',
        // Google Chat: list spaces, read members (sender names), read + send messages
        'https://www.googleapis.com/auth/chat.spaces.readonly',
        'https://www.googleapis.com/auth/chat.memberships.readonly',
        'https://www.googleapis.com/auth/chat.messages',
      ],
      state: generateState(companyId, userId),
    });
    return { authUrl };
  }

  async handleCallback(code: string, state: string): Promise<number> {
    const { companyId } = verifyState(state);
    const oauth2Client = makeOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.access_token || !tokens.refresh_token) {
      throw new BadRequestException('Missing tokens from Google');
    }
    oauth2Client.setCredentials(tokens);

    const grantedScopes = (tokens.scope ?? '').split(' ');
    const hasChatMessages = grantedScopes.some((s) =>
      s.includes('chat.messages'),
    );
    console.log('[Gmail] OAuth callback — granted scopes:', tokens.scope);
    if (!hasChatMessages) {
      console.warn(
        '[Gmail] chat.messages scope NOT granted. Chat replies will fail. Add it to the OAuth consent screen in Google Cloud Console.',
      );
    }

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const gmailAddress = userInfo.email;
    if (!gmailAddress)
      throw new BadRequestException('Could not read Gmail address');

    // The account's own Chat user id (= OIDC `sub`), used to hide self-sent
    // messages from the inbox. Falls back to the userinfo id if no id_token.
    const chatUserId = decodeIdTokenSub(tokens.id_token) ?? userInfo.id ?? null;

    const encKey = process.env.ENCRYPTION_KEY ?? '';
    const encAccessToken = encrypt(tokens.access_token, encKey);
    const encRefreshToken = encrypt(tokens.refresh_token, encKey);
    const tokenExpiry = new Date(
      tokens.expiry_date ?? Date.now() + 3600 * 1000,
    );

    await this.prisma.gmailAccount.upsert({
      where: { companyId },
      create: {
        companyId,
        gmailAddress,
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        tokenExpiry,
        chatUserId,
        scope: tokens.scope ?? null,
      },
      update: {
        gmailAddress,
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        tokenExpiry,
        chatUserId,
        scope: tokens.scope ?? null,
      },
    });

    // Start Gmail push watch (best-effort — silently skip if Pub/Sub not configured)
    void this.startWatch(companyId).catch(() => undefined);

    return companyId;
  }

  // ── Watch (Pub/Sub) ──────────────────────────────────────────────────────

  private async startWatch(companyId: number): Promise<void> {
    const topicName = process.env.PUBSUB_TOPIC_NAME;
    if (!topicName) return;

    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.watch({
      userId: 'me',
      requestBody: { topicName, labelIds: ['INBOX'] },
    });

    const historyId = res.data.historyId ? BigInt(res.data.historyId) : null;
    const watchExpiry = res.data.expiration
      ? new Date(Number(res.data.expiration))
      : null;

    await this.prisma.gmailAccount.update({
      where: { companyId },
      data: { lastHistoryId: historyId, watchExpiry },
    });
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async renewExpiringWatches(): Promise<void> {
    const threshold = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const accounts = await this.prisma.gmailAccount.findMany({
      where: { watchExpiry: { lte: threshold } },
    });
    for (const acc of accounts) {
      await this.startWatch(acc.companyId).catch(() => undefined);
    }
  }

  // ── Token management ─────────────────────────────────────────────────────

  private async ensureFreshTokens(companyId: number) {
    const record = await this.prisma.gmailAccount.findUnique({
      where: { companyId },
    });
    if (!record)
      throw new NotFoundException(
        'No Gmail account connected for this company',
      );

    const encKey = process.env.ENCRYPTION_KEY ?? '';
    const accessToken = decrypt(record.accessToken, encKey);
    const refreshToken = decrypt(record.refreshToken, encKey);

    const oauth2Client = makeOAuth2Client();
    oauth2Client.setCredentials({
      access_token: accessToken,
      refresh_token: refreshToken,
    });

    if (record.tokenExpiry <= new Date(Date.now() + 60 * 1000)) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        await this.prisma.gmailAccount.update({
          where: { companyId },
          data: {
            accessToken: encrypt(credentials.access_token, encKey),
            tokenExpiry: new Date(
              credentials.expiry_date ?? Date.now() + 3600 * 1000,
            ),
          },
        });
        oauth2Client.setCredentials(credentials);
      }
    }

    return oauth2Client;
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async getAccount(companyId: number) {
    const record = await this.prisma.gmailAccount.findUnique({
      where: { companyId },
    });
    if (!record) throw new NotFoundException('No Gmail account connected');
    return {
      gmailAddress: record.gmailAddress,
      connectedAt: record.connectedAt,
      // Whether Google granted the Chat *send* scope on the last connect (exact
      // token match — the read-only chat scope does not count). false → this
      // account was connected before chat replies existed and must reconnect.
      hasChatScope: grantsChatSend(record.scope),
    };
  }

  async getEmails(companyId: number, pageToken?: string, labelIds?: string[]) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
      pageToken,
      labelIds: labelIds ?? ['INBOX'],
    });

    const msgList = listRes.data.messages ?? [];
    const messages = await Promise.all(
      msgList.map(async (m) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: m.id!,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const headers = detail.data.payload?.headers ?? [];
        const h = (name: string) =>
          headers.find((x) => x.name === name)?.value ?? '';
        const labelIds = detail.data.labelIds ?? [];
        return {
          id: m.id!,
          subject: h('Subject'),
          from: h('From'),
          date: h('Date'),
          snippet: detail.data.snippet ?? '',
          isRead: !labelIds.includes('UNREAD'),
        };
      }),
    );

    return { messages, nextPageToken: listRes.data.nextPageToken ?? null };
  }

  async markAsRead(companyId: number, messageId: string) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }

  /**
   * Returns Google Chat messages as a flat, per-message inbox list (like emails):
   * one entry per incoming message, newest first, with a shared per-message
   * read/unread flag. Self-sent messages (matching the account's own chatUserId)
   * are hidden from the inbox. A message is READ iff a ChatMessageReadState row
   * exists for it.
   */
  async getChats(companyId: number) {
    let auth: Awaited<ReturnType<typeof this.ensureFreshTokens>>;
    try {
      auth = await this.ensureFreshTokens(companyId);
    } catch {
      return {
        messages: [],
        needsReconnect: true,
        chatStatus: 'needs_reconnect' as const,
      };
    }

    try {
      const chat = google.chat({ version: 'v1', auth });
      const spacesRes = await chat.spaces.list({ pageSize: 20 });
      const spaces = spacesRes.data.spaces ?? [];

      if (spaces.length === 0) {
        return {
          messages: [],
          needsReconnect: false,
          chatStatus: 'no_spaces' as const,
        };
      }

      const messages: (ChatMessageDto & { isRead: boolean })[] = [];

      // The account's own Chat user id (= OIDC `sub`) — used to hide self-sent
      // messages from the inbox. Read via raw SQL so this doesn't depend on the
      // Prisma client being regenerated (mirrors the TaskSchedule raw-SQL convention).
      const acctRows = await this.prisma.$queryRaw<
        { chatUserId: string | null }[]
      >`
        SELECT chatUserId FROM GmailAccount WHERE companyId = ${companyId} LIMIT 1
      `;
      const selfName = acctRows[0]?.chatUserId
        ? `users/${acctRows[0].chatUserId}`
        : null;

      // Shared per-message read state (raw SQL). A message is read iff a row exists.
      const readRows = await this.prisma.$queryRaw<{ messageId: string }[]>`
        SELECT messageId FROM ChatMessageReadState WHERE companyId = ${companyId}
      `;
      const readSet = new Set<string>(readRows.map((r) => r.messageId));

      // Build a user-resource-name → displayName map from space members
      // (the message sender object often omits displayName for DM participants)
      const memberDisplayNames = new Map<string, string>();
      await Promise.allSettled(
        spaces.map(async (space) => {
          try {
            const membersRes = await chat.spaces.members.list({
              parent: space.name!,
              pageSize: 100,
            });
            for (const m of membersRes.data.memberships ?? []) {
              if (m.member?.name && m.member.displayName) {
                memberDisplayNames.set(m.member.name, m.member.displayName);
              }
            }
          } catch {
            // ignore — member fetch failure doesn't block message display
          }
        }),
      );

      let failedSpaces = 0;
      let firstSpaceError: { status?: number; message?: string } | undefined;
      for (const space of spaces) {
        const spaceType = space.spaceType ?? 'SPACE';
        const spaceName =
          space.displayName ||
          (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
        try {
          // Fetch the NEWEST messages of each space as individual inbox rows.
          // The Chat API defaults to createTime ASC (oldest first), so without
          // an explicit orderBy this returned the oldest 15 and never surfaced
          // new messages. Some space types may reject orderBy — fall back to an
          // unordered list in that case.
          const listArgs = { parent: space.name!, pageSize: 15 };
          // Initialize directly (not `let msgsRes;`) so the response stays typed.
          const msgsRes = await chat.spaces.messages
            .list({ ...listArgs, orderBy: 'createTime DESC' })
            .catch(() => chat.spaces.messages.list(listArgs));
          for (const msg of msgsRes.data.messages ?? []) {
            // Hide messages the connected account sent itself (incoming-only inbox).
            if (selfName && msg.sender?.name === selfName) continue;
            const senderName =
              msg.sender?.displayName ||
              (msg.sender?.name
                ? memberDisplayNames.get(msg.sender.name)
                : undefined) ||
              'Unknown';
            const id = msg.name ?? '';
            messages.push({
              id,
              spaceId: space.name ?? '',
              spaceName,
              spaceType,
              sender: senderName,
              text: msg.text ?? '',
              createTime: msg.createTime ?? '',
              lastUpdateTime: msg.lastUpdateTime ?? msg.createTime ?? '',
              quotedMessageName: msg.quotedMessageMetadata?.name ?? null,
              isRead: readSet.has(id),
            });
          }
        } catch (err) {
          const spaceErr = err as {
            response?: { status?: number };
            code?: number | string;
            message?: string;
          };
          const spaceStatus =
            (spaceErr.response?.status ?? Number(spaceErr.code ?? 0)) ||
            undefined;
          console.error(
            `[Gmail] Failed to load messages for space ${space.name ?? '?'} type=${spaceType} (HTTP ${spaceStatus ?? '?'}):`,
            spaceErr.message ?? err,
          );
          if (!firstSpaceError)
            firstSpaceError = {
              status: spaceStatus,
              message: spaceErr.message,
            };
          failedSpaces++;
        }
      }

      if (failedSpaces > 0 && failedSpaces === spaces.length) {
        if (
          firstSpaceError?.status === 403 ||
          firstSpaceError?.status === 401
        ) {
          return {
            messages: [],
            needsReconnect: true,
            chatStatus: 'needs_reconnect' as const,
          };
        }
        if (firstSpaceError?.status === 404) {
          return {
            messages: [],
            needsReconnect: false,
            chatStatus: 'app_not_configured' as const,
          };
        }
        return {
          messages: [],
          needsReconnect: false,
          chatStatus: 'error' as const,
        };
      }

      // Newest messages first
      messages.sort(
        (a, b) =>
          new Date(b.createTime).getTime() - new Date(a.createTime).getTime(),
      );

      return { messages, needsReconnect: false, chatStatus: 'ok' as const };
    } catch (err: unknown) {
      console.error('[Gmail] getChats error:', err);
      const errAny = err as {
        response?: { status?: number };
        code?: number | string;
        status?: number;
        cause?: { status?: string };
        message?: string;
      };
      // GaxiosError stores the HTTP status at response.status; fall back to code/status for other error types
      const httpStatus =
        (errAny.response?.status ??
          Number(errAny.code ?? errAny.status ?? 0)) ||
        undefined;
      if (httpStatus === 403 || httpStatus === 401) {
        return {
          messages: [],
          needsReconnect: true,
          chatStatus: 'needs_reconnect' as const,
        };
      }
      if (httpStatus === 404) {
        return {
          messages: [],
          needsReconnect: false,
          chatStatus: 'app_not_configured' as const,
        };
      }
      const isChatDisabled =
        errAny.cause?.status === 'FAILED_PRECONDITION' ||
        String(errAny.message ?? '')
          .toLowerCase()
          .includes('chat is turned off') ||
        String(errAny.message ?? '')
          .toLowerCase()
          .includes('failed_precondition');
      if (httpStatus === 400 && isChatDisabled) {
        return {
          messages: [],
          needsReconnect: false,
          chatStatus: 'chat_disabled' as const,
        };
      }
      return {
        messages: [],
        needsReconnect: false,
        chatStatus: 'error' as const,
      };
    }
  }

  /**
   * Returns the message thread for a single Chat space (newest 50 per page),
   * sorted oldest→newest for the conversation bubble view. Powers "load older" via
   * nextPageToken. When `untilCreateTime` is given, the thread is frozen at that
   * moment — only messages created at or before it are returned (so opening an
   * older inbox row shows the conversation as it was then). Own messages are NOT
   * filtered here — they are part of the conversation.
   */
  async getChatThread(companyId: number, spaceId: string, pageToken?: string) {
    let auth: Awaited<ReturnType<typeof this.ensureFreshTokens>>;
    try {
      auth = await this.ensureFreshTokens(companyId);
    } catch {
      return { messages: [], nextPageToken: null, needsReconnect: true };
    }

    const chat = google.chat({ version: 'v1', auth });

    // Resolve member display names + space metadata for this space
    const memberDisplayNames = new Map<string, string>();
    try {
      const membersRes = await chat.spaces.members.list({
        parent: spaceId,
        pageSize: 100,
      });
      for (const m of membersRes.data.memberships ?? []) {
        if (m.member?.name && m.member.displayName) {
          memberDisplayNames.set(m.member.name, m.member.displayName);
        }
      }
    } catch {
      // ignore — member fetch failure doesn't block message display
    }

    let spaceType = 'SPACE';
    let spaceName = 'Direct Message';
    try {
      const sp = await chat.spaces.get({ name: spaceId });
      spaceType = sp.data.spaceType ?? 'SPACE';
      spaceName =
        sp.data.displayName ||
        (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
    } catch {
      // ignore — fall back to defaults
    }

    // Fetch the NEWEST ~100 messages so the clicked message and everything
    // after it are included. The Chat API defaults to createTime ASC (oldest
    // first) — without orderBy this returned the oldest 50 and could omit the
    // clicked (recent) message entirely. Some space types reject orderBy —
    // fall back to an unordered list in that case (mirrors getChats).
    const listArgs = { parent: spaceId, pageSize: 100, pageToken };
    // Initialize directly (not `let msgsRes;`) so the response stays typed.
    const msgsRes = await chat.spaces.messages
      .list({ ...listArgs, orderBy: 'createTime DESC' })
      .catch(() => chat.spaces.messages.list(listArgs));

    // The account's own Chat user id (= OIDC `sub`) — used to mark self-sent
    // messages so the client can show them as right-aligned bubbles. Read via
    // raw SQL (mirrors getChats / the TaskSchedule raw-SQL convention).
    const acctRows = await this.prisma.$queryRaw<
      { chatUserId: string | null }[]
    >`
      SELECT chatUserId FROM GmailAccount WHERE companyId = ${companyId} LIMIT 1
    `;
    const selfName = acctRows[0]?.chatUserId
      ? `users/${acctRows[0].chatUserId}`
      : null;

    // Return the WHOLE recent conversation (no freeze). The client dims the
    // messages newer than the anchor it was opened at.
    const messages: ChatMessageDto[] = (msgsRes.data.messages ?? []).map(
      (msg) => ({
        id: msg.name ?? '',
        spaceId,
        spaceName,
        spaceType,
        sender:
          msg.sender?.displayName ||
          (msg.sender?.name
            ? memberDisplayNames.get(msg.sender.name)
            : undefined) ||
          'Unknown',
        text: msg.text ?? '',
        createTime: msg.createTime ?? '',
        lastUpdateTime: msg.lastUpdateTime ?? msg.createTime ?? '',
        quotedMessageName: msg.quotedMessageMetadata?.name ?? null,
        isOwn: selfName ? msg.sender?.name === selfName : false,
      }),
    );
    messages.sort(
      (a, b) =>
        new Date(a.createTime).getTime() - new Date(b.createTime).getTime(),
    );

    return {
      messages,
      nextPageToken: msgsRes.data.nextPageToken ?? null,
      spaceName,
      spaceType,
    };
  }

  /** Marks a single chat message read for the whole company (shared state). */
  async markChatRead(companyId: number, messageId: string) {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO ChatMessageReadState (companyId, messageId, readAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE readAt = VALUES(readAt), updatedAt = VALUES(updatedAt)
    `;
  }

  /** Marks a single chat message unread for the whole company (removes its read row). */
  async markChatUnread(companyId: number, messageId: string) {
    await this.prisma.$executeRaw`
      DELETE FROM ChatMessageReadState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
  }

  async getUnreadCount(companyId: number) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    const emailUnread = res.data.messagesUnread ?? 0;

    let chatUnread = 0;
    try {
      const chats = await this.getChats(companyId);
      const msgs = (chats.messages ?? []) as { isRead: boolean }[];
      chatUnread = msgs.filter((m) => !m.isRead).length;
    } catch {
      // ignore chat failures — still return the email count
    }
    return { count: emailUnread + chatUnread };
  }

  async getEmail(companyId: number, messageId: string) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });

    const res = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const headers = res.data.payload?.headers ?? [];
    const h = (name: string) =>
      headers.find((x) => x.name === name)?.value ?? '';

    const payload = res.data.payload as Parameters<typeof extractPart>[0];
    const bodyHtml = extractPart(payload, 'text/html');
    const bodyText = extractPart(payload, 'text/plain');

    return {
      id: messageId,
      threadId: res.data.threadId ?? '',
      messageId: h('Message-ID'),
      subject: h('Subject'),
      from: h('From'),
      to: h('To'),
      date: h('Date'),
      snippet: res.data.snippet ?? '',
      bodyHtml,
      bodyText,
    };
  }

  async sendEmail(companyId: number, dto: SendEmailDto) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });

    const lines = [
      `To: ${dto.to}`,
      ...(dto.cc ? [`Cc: ${dto.cc}`] : []),
      `Subject: ${dto.subject}`,
      ...(dto.inReplyTo
        ? [`In-Reply-To: ${dto.inReplyTo}`, `References: ${dto.inReplyTo}`]
        : []),
      'Content-Type: text/plain; charset=utf-8',
      '',
      dto.body,
    ];

    const raw = Buffer.from(lines.join('\r\n')).toString('base64url');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, ...(dto.threadId ? { threadId: dto.threadId } : {}) },
    });
  }

  async markAsUnread(companyId: number, messageId: string) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });
    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: { addLabelIds: ['UNREAD'] },
    });
  }

  async sendChatMessage(companyId: number, dto: SendChatMessageDto) {
    const account = await this.prisma.gmailAccount.findUnique({
      where: { companyId },
      select: { scope: true },
    });
    const hasChatScope = grantsChatSend(account?.scope);

    const auth = await this.ensureFreshTokens(companyId);
    const chat = google.chat({ version: 'v1', auth });
    try {
      const res = await chat.spaces.messages.create({
        parent: dto.spaceId,
        requestBody: {
          text: dto.text,
          // Native "Quote in reply" (same as Google Chat) when a target is given.
          ...(dto.quotedMessageName && dto.quotedMessageLastUpdateTime
            ? {
                quotedMessageMetadata: {
                  name: dto.quotedMessageName,
                  lastUpdateTime: dto.quotedMessageLastUpdateTime,
                },
              }
            : {}),
        },
      });
      return {
        id: res.data.name ?? '',
        spaceId: dto.spaceId,
        sender: 'You',
        text: res.data.text ?? dto.text,
        createTime: res.data.createTime ?? new Date().toISOString(),
        lastUpdateTime:
          res.data.lastUpdateTime ??
          res.data.createTime ??
          new Date().toISOString(),
        quotedMessageName: res.data.quotedMessageMetadata?.name ?? null,
      };
    } catch (err: unknown) {
      const errAny = err as {
        response?: { status?: number };
        code?: number | string;
        status?: number;
        message?: string;
      };
      // GaxiosError stores the HTTP status at response.status; fall back to
      // code/status for other error shapes (mirrors getChats' extraction).
      const status =
        (errAny.response?.status ??
          Number(errAny.code ?? errAny.status ?? 0)) ||
        0;
      const detail = errAny.message ?? 'unknown error';
      if (status === 403 || status === 401) {
        // Surface what was actually granted so a stuck account is diagnosable.
        console.warn('[Gmail] chat send 403 — granted scope:', account?.scope);
        if (!hasChatScope) {
          // This account only granted read-only chat (it was connected before
          // chat replies existed). Reconnecting to grant the send scope fixes it.
          throw new BadRequestException(
            "This account hasn't granted permission to send chat messages — it was likely connected before chat replies were enabled. " +
              'Disconnect and reconnect the account, and approve the chat permission when Google asks.',
          );
        }
        // Send scope is present but Google still rejected this specific send.
        throw new BadRequestException(
          'Google rejected the send for this account. Try reconnecting; if it persists, make sure the account ' +
            `is still a member of this conversation. (${detail})`,
        );
      }
      throw new BadRequestException(detail);
    }
  }

  async disconnect(companyId: number) {
    const record = await this.prisma.gmailAccount.findUnique({
      where: { companyId },
    });
    if (!record) throw new NotFoundException('No Gmail account connected');

    // Best-effort revoke
    const encKey = process.env.ENCRYPTION_KEY ?? '';
    try {
      const accessToken = decrypt(record.accessToken, encKey);
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
        },
      );
    } catch {
      // ignore revoke errors
    }

    await this.prisma.gmailAccount.delete({ where: { companyId } });
  }

  // ── Pub/Sub webhook ──────────────────────────────────────────────────────

  async handleWebhook(body: { message?: { data?: string } }) {
    if (!body.message?.data) return;
    const decoded = JSON.parse(
      Buffer.from(body.message.data, 'base64').toString('utf8'),
    ) as {
      emailAddress: string;
      historyId: string;
    };

    const record = await this.prisma.gmailAccount.findFirst({
      where: { gmailAddress: decoded.emailAddress },
    });
    if (!record) return;

    const newHistoryId = BigInt(decoded.historyId);
    await this.prisma.gmailAccount.update({
      where: { id: record.id },
      data: { lastHistoryId: newHistoryId },
    });

    this.broadcastNewEmail(record.companyId);
  }

  // ── SSE ──────────────────────────────────────────────────────────────────

  addSseClient(
    id: string,
    companyId: number,
    subject: Subject<{ data: string }>,
  ) {
    this.sseClients.set(id, { companyId, subject });
  }

  removeSseClient(id: string) {
    this.sseClients.delete(id);
  }

  broadcastNewEmail(companyId: number) {
    for (const [, client] of this.sseClients) {
      if (client.companyId === companyId) {
        client.subject.next({ data: JSON.stringify({ type: 'new-email' }) });
      }
    }
  }
}
