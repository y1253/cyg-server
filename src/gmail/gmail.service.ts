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

// ─── Encryption (mirrors companies.service.ts) ───────────────────────────────

const ALGORITHM = 'aes-256-cbc';

function encrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(text: string, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex');
  const [ivHex, encHex] = text.split(':');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  const payload = Buffer.from(JSON.stringify({ companyId, userId, ts: Date.now() })).toString(
    'base64url',
  );
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
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new UnauthorizedException('Invalid state signature');
  }
  const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    companyId: number;
    userId: number;
    ts: number;
  };
  if (Date.now() - parsed.ts > 10 * 60 * 1000) {
    throw new UnauthorizedException('State expired');
  }
  return { companyId: parsed.companyId, userId: parsed.userId };
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
    for (const part of payload.parts as typeof payload[]) {
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
  private readonly sseClients = new Map<string, { companyId: number; subject: Subject<{ data: string }> }>();

  constructor(private readonly prisma: PrismaService) {}

  // ── OAuth ────────────────────────────────────────────────────────────────

  generateAuthUrl(companyId: number, userId: number): { authUrl: string } {
    const oauth2Client = makeOAuth2Client();
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/chat.spaces.readonly',
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

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const gmailAddress = userInfo.email;
    if (!gmailAddress) throw new BadRequestException('Could not read Gmail address');

    const encKey = process.env.ENCRYPTION_KEY ?? '';
    const encAccessToken = encrypt(tokens.access_token, encKey);
    const encRefreshToken = encrypt(tokens.refresh_token, encKey);
    const tokenExpiry = new Date(tokens.expiry_date ?? Date.now() + 3600 * 1000);

    await this.prisma.gmailAccount.upsert({
      where: { companyId },
      create: {
        companyId,
        gmailAddress,
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        tokenExpiry,
      },
      update: {
        gmailAddress,
        accessToken: encAccessToken,
        refreshToken: encRefreshToken,
        tokenExpiry,
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
    const record = await this.prisma.gmailAccount.findUnique({ where: { companyId } });
    if (!record) throw new NotFoundException('No Gmail account connected for this company');

    const encKey = process.env.ENCRYPTION_KEY ?? '';
    const accessToken = decrypt(record.accessToken, encKey);
    const refreshToken = decrypt(record.refreshToken, encKey);

    const oauth2Client = makeOAuth2Client();
    oauth2Client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

    if (record.tokenExpiry <= new Date(Date.now() + 60 * 1000)) {
      const { credentials } = await oauth2Client.refreshAccessToken();
      if (credentials.access_token) {
        await this.prisma.gmailAccount.update({
          where: { companyId },
          data: {
            accessToken: encrypt(credentials.access_token, encKey),
            tokenExpiry: new Date(credentials.expiry_date ?? Date.now() + 3600 * 1000),
          },
        });
        oauth2Client.setCredentials(credentials);
      }
    }

    return oauth2Client;
  }

  // ── CRUD ─────────────────────────────────────────────────────────────────

  async getAccount(companyId: number) {
    const record = await this.prisma.gmailAccount.findUnique({ where: { companyId } });
    if (!record) throw new NotFoundException('No Gmail account connected');
    return { gmailAddress: record.gmailAddress, connectedAt: record.connectedAt };
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
        const h = (name: string) => headers.find((x) => x.name === name)?.value ?? '';
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

  async getChats(companyId: number) {
    let auth: Awaited<ReturnType<typeof this.ensureFreshTokens>>;
    try {
      auth = await this.ensureFreshTokens(companyId);
    } catch {
      return { messages: [], needsReconnect: true, chatStatus: 'needs_reconnect' as const };
    }

    try {
      const chat = google.chat({ version: 'v1', auth });
      const spacesRes = await chat.spaces.list({ pageSize: 20 });
      const spaces = spacesRes.data.spaces ?? [];

      if (spaces.length === 0) {
        return { messages: [], needsReconnect: false, chatStatus: 'no_spaces' as const };
      }

      const allMessages: {
        id: string;
        spaceId: string;
        spaceName: string;
        spaceType: string;
        sender: string;
        text: string;
        createTime: string;
      }[] = [];

      let failedSpaces = 0;
      let firstSpaceError: { status?: number; message?: string } | undefined;
      for (const space of spaces) {
        try {
          const msgsRes = await chat.spaces.messages.list({
            parent: space.name!,
            pageSize: 15,
            orderBy: 'createTime desc',
          });
          const spaceType = space.spaceType ?? 'SPACE';
          const spaceName =
            space.displayName ||
            (spaceType === 'DIRECT_MESSAGE' ? 'Direct Message' : 'Unknown Space');
          for (const msg of msgsRes.data.messages ?? []) {
            allMessages.push({
              id: msg.name ?? '',
              spaceId: space.name ?? '',
              spaceName,
              spaceType,
              sender: msg.sender?.displayName ?? msg.sender?.name ?? 'Unknown',
              text: msg.text ?? '',
              createTime: msg.createTime ?? '',
            });
          }
        } catch (err) {
          const spaceErr = err as { response?: { status?: number }; code?: number | string; message?: string };
          const spaceStatus = (spaceErr.response?.status ?? Number(spaceErr.code ?? 0)) || undefined;
          console.error(`[Gmail] Failed to load messages for space ${space.name ?? '?'} (HTTP ${spaceStatus ?? '?'}):`, spaceErr.message ?? err);
          if (!firstSpaceError) firstSpaceError = { status: spaceStatus, message: spaceErr.message };
          failedSpaces++;
        }
      }

      if (failedSpaces > 0 && failedSpaces === spaces.length) {
        if (firstSpaceError?.status === 403 || firstSpaceError?.status === 401) {
          return { messages: [], needsReconnect: true, chatStatus: 'needs_reconnect' as const };
        }
        if (firstSpaceError?.status === 404) {
          return { messages: [], needsReconnect: false, chatStatus: 'app_not_configured' as const };
        }
        return { messages: [], needsReconnect: false, chatStatus: 'error' as const };
      }

      return { messages: allMessages, needsReconnect: false, chatStatus: 'ok' as const };
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
      const httpStatus = (errAny.response?.status ?? Number(errAny.code ?? errAny.status ?? 0)) || undefined;
      if (httpStatus === 403 || httpStatus === 401) {
        return { messages: [], needsReconnect: true, chatStatus: 'needs_reconnect' as const };
      }
      if (httpStatus === 404) {
        return { messages: [], needsReconnect: false, chatStatus: 'app_not_configured' as const };
      }
      const isChatDisabled =
        errAny.cause?.status === 'FAILED_PRECONDITION' ||
        String(errAny.message ?? '').toLowerCase().includes('chat is turned off') ||
        String(errAny.message ?? '').toLowerCase().includes('failed_precondition');
      if (httpStatus === 400 && isChatDisabled) {
        return { messages: [], needsReconnect: false, chatStatus: 'chat_disabled' as const };
      }
      return { messages: [], needsReconnect: false, chatStatus: 'error' as const };
    }
  }

  async getUnreadCount(companyId: number) {
    const auth = await this.ensureFreshTokens(companyId);
    const gmail = google.gmail({ version: 'v1', auth });
    const res = await gmail.users.labels.get({ userId: 'me', id: 'INBOX' });
    return { count: res.data.messagesUnread ?? 0 };
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
    const h = (name: string) => headers.find((x) => x.name === name)?.value ?? '';

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
      ...(dto.inReplyTo ? [`In-Reply-To: ${dto.inReplyTo}`, `References: ${dto.inReplyTo}`] : []),
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
    const auth = await this.ensureFreshTokens(companyId);
    const chat = google.chat({ version: 'v1', auth });
    try {
      await chat.spaces.messages.create({
        parent: dto.spaceId,
        requestBody: { text: dto.text },
      });
    } catch (err: unknown) {
      const errAny = err as { message?: string };
      throw new BadRequestException(errAny.message ?? 'Failed to send Chat message');
    }
  }

  async disconnect(companyId: number) {
    const record = await this.prisma.gmailAccount.findUnique({ where: { companyId } });
    if (!record) throw new NotFoundException('No Gmail account connected');

    // Best-effort revoke
    const encKey = process.env.ENCRYPTION_KEY ?? '';
    try {
      const accessToken = decrypt(record.accessToken, encKey);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(accessToken)}`, {
        method: 'POST',
      });
    } catch {
      // ignore revoke errors
    }

    await this.prisma.gmailAccount.delete({ where: { companyId } });
  }

  // ── Pub/Sub webhook ──────────────────────────────────────────────────────

  async handleWebhook(body: { message?: { data?: string } }) {
    if (!body.message?.data) return;
    const decoded = JSON.parse(Buffer.from(body.message.data, 'base64').toString('utf8')) as {
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

  addSseClient(id: string, companyId: number, subject: Subject<{ data: string }>) {
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
