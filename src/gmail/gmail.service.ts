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
      scope: ['https://www.googleapis.com/auth/gmail.modify'],
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
        return {
          id: m.id!,
          subject: h('Subject'),
          from: h('From'),
          date: h('Date'),
          snippet: detail.data.snippet ?? '',
        };
      }),
    );

    return { messages, nextPageToken: listRes.data.nextPageToken ?? null };
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

    const message = [
      `To: ${dto.to}`,
      `Subject: ${dto.subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      dto.body,
    ].join('\r\n');

    const raw = Buffer.from(message).toString('base64url');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
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
