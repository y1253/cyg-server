import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
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
  // Attachments carried by this Chat message (images, clips, files). Empty/omitted
  // when the message has none.
  attachments?: ChatAttachmentDto[];
}

// Attachment metadata parsed from a Gmail message's MIME parts. The bytes are
// fetched on demand via the download endpoint using `attachmentId`.
export interface EmailAttachmentDto {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
  // Content-ID (angle brackets stripped) — used to resolve inline `cid:` refs in
  // the HTML body. null when the part has no Content-ID.
  contentId: string | null;
  // True when the part is displayed inline in the body (Content-Disposition:
  // inline, or a Content-ID is present). Inline images are hidden from the strip.
  isInline: boolean;
}

// Attachment metadata from a Google Chat message. Uploaded content streams via
// `resourceName` (media.download); Drive-hosted files expose only `driveFileId`
// (opened via a Drive link — we don't hold a Drive scope to stream them).
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

// Shape of a raw Gmail MIME part (the fields we care about).
interface GmailPart {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[];
  body?: {
    data?: string | null;
    size?: number | null;
    attachmentId?: string | null;
  };
  parts?: GmailPart[];
}

// Recursively walk a Gmail message payload and collect every part that is a real
// attachment (has both a filename and a body.attachmentId). Inline images and
// regular file attachments both surface here; the client decides how to render each.
// A part is only classified `isInline` (hidden from the attachment strip because
// it's rendered in the body) when it declares `Content-Disposition: inline` OR its
// Content-ID is actually referenced by a `cid:` in the HTML body. A Content-ID on
// its own does NOT hide the part — many clients stamp one on every attachment, and
// treating those as inline made real files vanish from the strip.
function extractAttachments(
  payload: GmailPart | undefined,
  referencedCids: Set<string>,
): EmailAttachmentDto[] {
  const out: EmailAttachmentDto[] = [];
  const walk = (part: GmailPart | undefined) => {
    if (!part) return;
    const attachmentId = part.body?.attachmentId ?? undefined;
    if (part.filename && attachmentId) {
      const header = (name: string) =>
        part.headers?.find((h) => h.name?.toLowerCase() === name)?.value ??
        null;
      const rawCid = header('content-id');
      const contentId = rawCid ? rawCid.replace(/^<|>$/g, '') : null;
      const disposition = (header('content-disposition') ?? '')
        .trim()
        .toLowerCase();
      out.push({
        filename: part.filename,
        mimeType: part.mimeType ?? 'application/octet-stream',
        size: part.body?.size ?? 0,
        attachmentId,
        contentId,
        isInline:
          disposition.startsWith('inline') ||
          (contentId !== null && referencedCids.has(contentId)),
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

// Shape of a raw Google Chat attachment (the fields we care about).
interface ChatAttachment {
  name?: string | null;
  contentName?: string | null;
  contentType?: string | null;
  attachmentDataRef?: { resourceName?: string | null } | null;
  driveDataRef?: { driveFileId?: string | null } | null;
  thumbnailUri?: string | null;
  downloadUri?: string | null;
  source?: string | null;
}

// Map a Chat message's raw attachment array to the client-facing DTO shape.
function mapChatAttachments(
  attachment: ChatAttachment[] | null | undefined,
): ChatAttachmentDto[] {
  return (attachment ?? []).map((a) => ({
    name: a.name ?? '',
    contentName: a.contentName ?? 'attachment',
    contentType: a.contentType ?? 'application/octet-stream',
    resourceName: a.attachmentDataRef?.resourceName ?? null,
    driveFileId: a.driveDataRef?.driveFileId ?? null,
    thumbnailUri: a.thumbnailUri ?? null,
    downloadUri: a.downloadUri ?? null,
    source: a.source ?? null,
  }));
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

  async getEmails(
    companyId: number,
    pageToken?: string,
    labelIds?: string[],
    q?: string,
  ) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      maxResults: 20,
      pageToken,
      labelIds: labelIds ?? ['INBOX'],
      ...(q ? { q } : {}),
    });

    const msgList = listRes.data.messages ?? [];
    // Shared per-message "completed" state (raw SQL). Completed iff a row exists.
    const completedRows = await this.prisma.$queryRaw<{ messageId: string }[]>`
      SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
    `;
    const completedSet = new Set<string>(completedRows.map((r) => r.messageId));
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
          isCompleted: completedSet.has(m.id!),
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
  async getChats(companyId: number, cursor?: string, q?: string) {
    // Google Chat has no text-search API, so a search term is matched here over
    // the fetched messages (sender / space / text). Lower-cased once for reuse.
    const query = q?.trim().toLowerCase();
    let auth: Awaited<ReturnType<typeof this.ensureFreshTokens>>;
    try {
      auth = await this.ensureFreshTokens(companyId);
    } catch {
      return {
        messages: [],
        needsReconnect: true,
        chatStatus: 'needs_reconnect' as const,
        nextCursor: null,
        hasMore: false,
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
          nextCursor: null,
          hasMore: false,
        };
      }

      // Infinite-scroll cursor: a base64 JSON map { spaceName: pageToken }. On the
      // first page (no cursor) every space is fetched from its newest message; on
      // later pages only spaces with a saved pageToken are continued (older).
      let cursorMap: Record<string, string> | null = null;
      if (cursor) {
        try {
          cursorMap = JSON.parse(
            Buffer.from(cursor, 'base64').toString('utf8'),
          ) as Record<string, string>;
        } catch {
          cursorMap = null;
        }
      }
      const targetSpaces = cursorMap
        ? spaces.filter((s) => s.name && cursorMap![s.name])
        : spaces;

      const messages: (ChatMessageDto & {
        isRead: boolean;
        isCompleted: boolean;
        hasAttachments: boolean;
      })[] = [];

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

      // Shared per-message "completed" state (raw SQL). Completed iff a row exists.
      const completedRows = await this.prisma.$queryRaw<{ messageId: string }[]>`
        SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
      `;
      const completedSet = new Set<string>(
        completedRows.map((r) => r.messageId),
      );

      // Build a user-resource-name → displayName map from space members
      // (the message sender object often omits displayName for DM participants)
      const memberDisplayNames = new Map<string, string>();
      await Promise.allSettled(
        targetSpaces.map(async (space) => {
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
      // Per-space pageToken for the NEXT (older) page — becomes the next cursor.
      const nextTokens: Record<string, string> = {};
      for (const space of targetSpaces) {
        const spaceType = space.spaceType ?? 'SPACE';
        const spaceName =
          space.displayName ||
          (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
        try {
          // Fetch the NEWEST messages of each space as individual inbox rows.
          // The Chat API defaults to createTime ASC (oldest first), so without
          // an explicit orderBy this returned the oldest 15 and never surfaced
          // new messages. Some space types may reject orderBy — fall back to an
          // unordered list in that case. On later pages the saved pageToken
          // continues the same space into older messages.
          const pageToken = cursorMap ? cursorMap[space.name!] : undefined;
          const listArgs = {
            parent: space.name!,
            // Widen the window when searching (Chat has no text-search, so we
            // scan more recent messages per space) — otherwise keep the inbox lean.
            pageSize: query ? 50 : 15,
            ...(pageToken ? { pageToken } : {}),
          };
          // Initialize directly (not `let msgsRes;`) so the response stays typed.
          const msgsRes = await chat.spaces.messages
            .list({ ...listArgs, orderBy: 'createTime DESC' })
            .catch(() => chat.spaces.messages.list(listArgs));
          if (msgsRes.data.nextPageToken && space.name) {
            nextTokens[space.name] = msgsRes.data.nextPageToken;
          }
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
            const text = msg.text ?? '';
            // Apply the search term (Chat has no server text-search).
            if (
              query &&
              ![text, senderName, spaceName].some((s) =>
                s.toLowerCase().includes(query),
              )
            ) {
              continue;
            }
            messages.push({
              id,
              spaceId: space.name ?? '',
              spaceName,
              spaceType,
              sender: senderName,
              text,
              createTime: msg.createTime ?? '',
              lastUpdateTime: msg.lastUpdateTime ?? msg.createTime ?? '',
              quotedMessageName: msg.quotedMessageMetadata?.name ?? null,
              isRead: readSet.has(id),
              isCompleted: completedSet.has(id),
              hasAttachments: (msg.attachment?.length ?? 0) > 0,
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

      if (failedSpaces > 0 && failedSpaces === targetSpaces.length) {
        if (
          firstSpaceError?.status === 403 ||
          firstSpaceError?.status === 401
        ) {
          return {
            messages: [],
            needsReconnect: true,
            chatStatus: 'needs_reconnect' as const,
            nextCursor: null,
            hasMore: false,
          };
        }
        if (firstSpaceError?.status === 404) {
          return {
            messages: [],
            needsReconnect: false,
            chatStatus: 'app_not_configured' as const,
            nextCursor: null,
            hasMore: false,
          };
        }
        return {
          messages: [],
          needsReconnect: false,
          chatStatus: 'error' as const,
          nextCursor: null,
          hasMore: false,
        };
      }

      // Newest messages first
      messages.sort(
        (a, b) =>
          new Date(b.createTime).getTime() - new Date(a.createTime).getTime(),
      );

      // Spaces that still have older messages → the next cursor.
      const hasMore = Object.keys(nextTokens).length > 0;
      const nextCursor = hasMore
        ? Buffer.from(JSON.stringify(nextTokens)).toString('base64')
        : null;

      return {
        messages,
        needsReconnect: false,
        chatStatus: 'ok' as const,
        nextCursor,
        hasMore,
      };
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
          nextCursor: null,
          hasMore: false,
        };
      }
      if (httpStatus === 404) {
        return {
          messages: [],
          needsReconnect: false,
          chatStatus: 'app_not_configured' as const,
          nextCursor: null,
          hasMore: false,
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
          nextCursor: null,
          hasMore: false,
        };
      }
      return {
        messages: [],
        needsReconnect: false,
        chatStatus: 'error' as const,
        nextCursor: null,
        hasMore: false,
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
        attachments: mapChatAttachments(msg.attachment),
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

  /**
   * Marks a single message (email or chat) completed for the whole company
   * (shared state). Completed iff a row exists. `messageId` is a Gmail message id
   * or a Google Chat resource name — the two never collide, so one table serves both.
   */
  async markComplete(companyId: number, messageId: string) {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
    `;
  }

  /** Clears the completed state for a single message (removes its row). */
  async markUncomplete(companyId: number, messageId: string) {
    await this.prisma.$executeRaw`
      DELETE FROM MessageCompletedState WHERE companyId = ${companyId} AND messageId = ${messageId}
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
    // Cids the HTML body actually embeds — only these attachments are "inline".
    const referencedCids = new Set<string>();
    for (const m of (bodyHtml ?? '').matchAll(/cid:([^"'>\s)]+)/gi)) {
      referencedCids.add(m[1]);
      try {
        referencedCids.add(decodeURIComponent(m[1]));
      } catch {
        // keep raw cid if it isn't valid percent-encoding
      }
    }
    const attachments = extractAttachments(
      payload as GmailPart | undefined,
      referencedCids,
    );

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
      attachments,
    };
  }

  // Fetch the raw bytes of a Gmail attachment. Covered by the existing
  // gmail.modify scope. Gmail returns the data base64url-encoded.
  async getEmailAttachment(
    companyId: number,
    messageId: string,
    attachmentId: string,
  ): Promise<Buffer> {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: attachmentId,
    });
    return Buffer.from(res.data.data ?? '', 'base64url');
  }

  // Fetch the raw bytes of an uploaded Google Chat attachment via the media API.
  // Covered by the existing chat.messages scope. `resourceName` comes from the
  // attachment's attachmentDataRef.resourceName (Drive-hosted files aren't
  // streamable here and are handled as links by the client instead).
  async getChatAttachment(
    companyId: number,
    resourceName: string,
  ): Promise<Buffer> {
    const auth = await this.ensureFreshTokens(companyId);
    const chat = google.chat({ version: 'v1', auth });
    // `alt: 'media'` is REQUIRED — without it the media endpoint returns metadata
    // JSON ({ resourceName }) instead of the file bytes, producing a corrupt download.
    const res = await chat.media.download(
      { resourceName, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as unknown as ArrayBuffer);
  }

  // Transcode arbitrary audio bytes to MP3 via bundled ffmpeg. Many chat voice
  // recordings use codecs (Opus/AMR in .m4a) that browsers can't decode inline;
  // MP3 is universally playable, so we transcode on the fly for the inline player.
  async transcodeAudioToMp3(input: Buffer): Promise<Buffer> {
    if (!ffmpegPath) throw new Error('ffmpeg binary not available');
    const bin: string = ffmpegPath;
    return new Promise<Buffer>((resolve, reject) => {
      const proc = spawn(bin, [
        '-i',
        'pipe:0',
        '-vn',
        '-c:a',
        'libmp3lame',
        '-q:a',
        '4',
        '-f',
        'mp3',
        'pipe:1',
      ]);
      const chunks: Buffer[] = [];
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => chunks.push(d));
      proc.stderr.on('data', (d: Buffer) => {
        stderr += d.toString();
      });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      });
      proc.stdin.on('error', () => {
        /* ignore EPIPE if ffmpeg closes stdin early */
      });
      proc.stdin.write(input);
      proc.stdin.end();
    });
  }

  async sendEmail(
    companyId: number,
    dto: SendEmailDto,
    attachments: Array<{
      originalname: string;
      mimetype: string;
      buffer: Buffer;
    }> = [],
  ) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });

    // Build the standard CYG signature from live company details. Fetched here on
    // every send (no caching): editing the billing email / business name / support
    // number in company details is reflected on the very next email sent.
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
        businessName: true,
        supportNumber: true,
        billing: { select: { billingEmail: true } },
      },
    });
    const sigEmail = company?.billing?.billingEmail ?? null;

    const sigPlain = [
      company?.businessName ?? '',
      '',
      `accounting department${company?.supportNumber ? ` ${company.supportNumber}` : ''}`,
      ...(sigEmail ? [sigEmail] : []),
      'accounting managed by CYG FINANCE (https://cygfinance.com)',
    ].join('\n');

    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const sigHtml =
      '<br><br><div>' +
      [
        `<div>${esc(company?.businessName ?? '')}</div>`,
        '<div><br></div>',
        `<div>accounting department${company?.supportNumber ? ` ${esc(company.supportNumber)}` : ''}</div>`,
        ...(sigEmail ? [`<div>${esc(sigEmail)}</div>`] : []),
        `<div><a href="https://cygfinance.com">accounting managed by CYG FINANCE</a></div>`,
      ].join('') +
      '</div>';

    dto.body = `${dto.body}\n\n${sigPlain}`;
    if (dto.bodyHtml && dto.bodyHtml.trim() !== '') {
      dto.bodyHtml = `${dto.bodyHtml}${sigHtml}`;
    }

    const headers = [
      `To: ${dto.to}`,
      ...(dto.cc ? [`Cc: ${dto.cc}`] : []),
      `Subject: ${dto.subject ?? ''}`,
      ...(dto.inReplyTo
        ? [`In-Reply-To: ${dto.inReplyTo}`, `References: ${dto.inReplyTo}`]
        : []),
      'MIME-Version: 1.0',
    ];

    // Base64-encode + wrap at 76 cols per RFC 2045.
    const b64wrap = (input: Buffer | string): string =>
      (Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8'))
        .toString('base64')
        .replace(/(.{76})/g, '$1\r\n');

    // The message "content node": its own Content-Type header line(s) plus the
    // body lines that follow the blank line. Either a single text/plain part or
    // a multipart/alternative (text/plain fallback + text/html) when the caller
    // supplied rich-text HTML. This node is emitted directly for a plain message
    // or nested as the first part of a multipart/mixed when attachments exist.
    const hasHtml = !!dto.bodyHtml && dto.bodyHtml.trim() !== '';
    let contentHeader: string[];
    let contentBody: string[];
    if (hasHtml) {
      const altBoundary = `alt_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2)}`;
      contentHeader = [
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      ];
      contentBody = [
        `--${altBoundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64wrap(dto.body),
        `--${altBoundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64wrap(dto.bodyHtml as string),
        `--${altBoundary}--`,
      ];
    } else {
      contentHeader = ['Content-Type: text/plain; charset=utf-8'];
      contentBody = [dto.body];
    }

    let message: string;
    if (attachments.length === 0) {
      message = [...headers, ...contentHeader, '', ...contentBody].join('\r\n');
    } else {
      // multipart/mixed: the content node is the first part, followed by one
      // base64-encoded part per attachment. Distinct boundary from any nested
      // multipart/alternative above.
      const mixBoundary = `mix_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2)}`;
      const parts: string[] = [
        `--${mixBoundary}`,
        ...contentHeader,
        '',
        ...contentBody,
      ];
      for (const f of attachments) {
        const name = (f.originalname || 'attachment').replace(
          /["\r\n\\]/g,
          '_',
        );
        parts.push(
          `--${mixBoundary}`,
          `Content-Type: ${f.mimetype || 'application/octet-stream'}; name="${name}"`,
          'Content-Transfer-Encoding: base64',
          `Content-Disposition: attachment; filename="${name}"`,
          '',
          b64wrap(f.buffer),
        );
      }
      parts.push(`--${mixBoundary}--`, '');
      message = [
        ...headers,
        `Content-Type: multipart/mixed; boundary="${mixBoundary}"`,
        '',
        ...parts,
      ].join('\r\n');
    }

    const raw = Buffer.from(message).toString('base64url');
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
