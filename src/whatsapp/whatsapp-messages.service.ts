import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import * as path from 'path';
import { Prisma, type WhatsAppMessage } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { resolveStoredPath } from '../internal-messages/uploads.js';
import {
  runFfmpeg,
  runFfmpegDetailed,
} from '../communications/attachment-stream.util.js';
import { parseDurationMs } from '../phone-audio/phone-audio.util.js';
import { WhatsAppAccountService } from './whatsapp-account.service.js';
import {
  WhatsAppGraphError,
  WhatsAppGraphService,
} from './whatsapp-graph.service.js';
import {
  WHATSAPP_PLAYBACK_MP3_ARGS,
  WHATSAPP_VOICE_ARGS,
  baseMime,
  extensionForMime,
  friendlyGraphMessage,
  isWindowOpen,
  mediaFilename,
  nextDeliveryStatus,
  normalizeWaId,
  whatsappItemId,
  windowOpenUntil,
  type ParsedChange,
  type ParsedStatus,
} from './whatsapp.util.js';
import type {
  WhatsAppCounts,
  WhatsAppDeliveryStatus,
  WhatsAppItemDto,
  WhatsAppMediaStatus,
  WhatsAppMessageType,
  WhatsAppStateAction,
  WhatsAppThreadResult,
  WhatsAppTimelineResult,
} from './whatsapp.types.js';

/** Sub-path of UPLOADS_DIR that WhatsApp media is copied to. */
export const WHATSAPP_SUBDIR = 'whatsapp';

/** Meta's cap on an audio message. */
export const MAX_VOICE_BYTES = 16 * 1024 * 1024;

const THREAD_LIMIT = 200;
const MEDIA_MAX_ATTEMPTS = 3;
/** A download started by the webhook gets this long before the sweep second-guesses it. */
const MEDIA_RETRY_AFTER_MS = 2 * 60_000;
/** Meta deletes media after 30 days; past that a retry can only fail. */
const MEDIA_RETENTION_MS = 29 * 24 * 60 * 60_000;
const MEDIA_SWEEP_BATCH = 20;

export interface UploadedVoice {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

function toItem(
  row: WhatsAppMessage,
  names: Map<string, string>,
): WhatsAppItemDto {
  const outbound = row.direction === 'outbound';
  return {
    id: whatsappItemId(row.id),
    messageId: row.id,
    kind: 'whatsapp',
    direction: outbound ? 'outbound' : 'inbound',
    peer: row.peerWaId,
    peerName: names.get(row.peerWaId) ?? row.profileName ?? null,
    type: row.type as WhatsAppMessageType,
    body: row.body,
    isVoice: row.isVoice,
    durationSec: row.durationSec,
    hasMedia: row.mediaId !== null || row.storagePath !== null,
    mediaStatus: (row.mediaStatus as WhatsAppMediaStatus | null) ?? null,
    mimeType: row.mimeType,
    filename: row.filename,
    size: row.size,
    status: (row.status as WhatsAppDeliveryStatus | null) ?? null,
    errorCode: row.errorCode,
    at: row.at.toISOString(),
    // A message you sent is not work: read AND completed by construction, the
    // InternalCall rule. The columns are written that way too; this just says so twice.
    isRead: outbound || row.readAt !== null,
    isCompleted: outbound || row.completedAt !== null,
  };
}

/** A Graph failure as an HTTP error a member of staff can read; anything else is rethrown. */
function toHttpError(err: unknown): never {
  if (err instanceof WhatsAppGraphError) {
    const message = friendlyGraphMessage(err.code, err.message);
    if (err.httpStatus === 0) throw new ServiceUnavailableException(message);
    throw new BadRequestException(message);
  }
  throw err;
}

/**
 * WhatsApp messages: stored from the webhook, listed like SMS, sent through Graph.
 *
 * ⚠️ PERSISTED, where SMS is fetched live. The Cloud API has no "list messages" endpoint
 * — a message exists for us only as the webhook delivery that announced it — so this
 * table is the whole history. The inbox architecture is otherwise SMS's exactly: one row
 * per message, a thread keyed by the customer's number, the anchor freeze client-side.
 */
@Injectable()
export class WhatsAppMessagesService {
  private readonly logger = new Logger(WhatsAppMessagesService.name);
  private readonly mediaInFlight = new Set<number>();
  private mediaSweepRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: WhatsAppGraphService,
    private readonly accounts: WhatsAppAccountService,
  ) {}

  // ── Inbound ──────────────────────────────────────────────────────────────

  /**
   * Store one webhook delivery. Runs AFTER the controller has answered 200, so it never
   * throws: each message and status is its own try.
   */
  async ingest(changes: ParsedChange[]): Promise<void> {
    for (const change of changes) {
      const account = await this.prisma.whatsAppAccount.findUnique({
        where: { phoneNumberId: change.phoneNumberId },
        select: { companyId: true },
      });
      if (!account) {
        // No company to file it under. Logged with counts so a misconfigured number is
        // visible rather than a quiet inbox.
        this.logger.warn(
          `webhook for unconnected phone_number_id ${change.phoneNumberId} dropped ` +
            `(${change.messages.length} messages, ${change.statuses.length} statuses)`,
        );
        continue;
      }

      for (const m of change.messages) {
        let row: WhatsAppMessage;
        try {
          row = await this.prisma.whatsAppMessage.create({
            data: {
              companyId: account.companyId,
              phoneNumberId: change.phoneNumberId,
              wamid: m.wamid,
              direction: 'inbound',
              peerWaId: m.from,
              profileName: m.profileName,
              type: m.type,
              body: m.body,
              mediaId: m.mediaId,
              mimeType: m.mimeType,
              filename: m.filename,
              isVoice: m.isVoice,
              mediaStatus: m.mediaId ? 'pending' : null,
              at: m.at,
            },
          });
        } catch (err) {
          // Meta retries a delivery it thinks failed; the unique wamid makes that a no-op.
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002'
          ) {
            continue;
          }
          this.logger.error(
            `storing inbound ${m.wamid} failed: ${String(err)}`,
          );
          continue;
        }
        this.logger.log(
          `inbound ${m.type} ${row.id} for company ${account.companyId} from ${m.from}`,
        );
        if (row.mediaId) {
          // The guard is load-bearing: a `void` on a rejecting promise is an unhandled
          // rejection, which Node exits the process on.
          void this.fetchMedia(row.id).catch(() => undefined);
        }
      }

      for (const s of change.statuses) {
        await this.applyStatus(s).catch((err) =>
          this.logger.warn(
            `status ${s.status} for ${s.wamid} failed: ${String(err)}`,
          ),
        );
      }
    }
  }

  private async applyStatus(s: ParsedStatus): Promise<void> {
    const row = await this.prisma.whatsAppMessage.findUnique({
      where: { wamid: s.wamid },
      select: { id: true, status: true },
    });
    // A status can beat the send's own row write by a few ms; losing a "sent" is harmless.
    if (!row) return;
    const next = nextDeliveryStatus(row.status, s.status);
    if (next === row.status) return;
    await this.prisma.whatsAppMessage.update({
      where: { id: row.id },
      data: {
        status: next,
        ...(s.errorCode ? { errorCode: s.errorCode } : {}),
      },
    });
  }

  // ── Media ────────────────────────────────────────────────────────────────

  /**
   * Copy a message's media onto our disk, plus an mp3 of any audio.
   *
   * Copied at arrival rather than proxied on demand: Meta deletes media after 30 days,
   * and a receipt a client sends has to outlive that. Never throws.
   */
  async fetchMedia(messageId: number): Promise<void> {
    if (this.mediaInFlight.has(messageId)) return;
    this.mediaInFlight.add(messageId);
    try {
      const row = await this.prisma.whatsAppMessage.findUnique({
        where: { id: messageId },
      });
      if (!row?.mediaId || row.mediaStatus === 'ready') return;

      const token = await this.accounts.tokenForPhoneNumber(row.phoneNumberId);
      if (!token)
        throw new Error(`no token for phone number ${row.phoneNumberId}`);

      const { bytes, mimeType } = await this.graph.downloadMedia(
        row.mediaId,
        token,
      );
      const mime = row.mimeType ?? mimeType;
      const storagePath = await this.store(bytes, extensionForMime(mime));

      let playbackPath: string | null = null;
      let durationSec: number | null = null;
      if (row.type === 'audio') {
        const playback = await this.makePlayback(bytes);
        if (playback.mp3) playbackPath = await this.store(playback.mp3, '.mp3');
        durationSec = playback.durationSec;
      }

      await this.prisma.whatsAppMessage.update({
        where: { id: row.id },
        data: {
          storagePath,
          playbackPath,
          durationSec,
          size: bytes.length,
          mimeType: mime,
          mediaStatus: 'ready',
        },
      });
    } catch (err) {
      const updated = await this.prisma.whatsAppMessage
        .update({
          where: { id: messageId },
          data: { mediaAttempts: { increment: 1 } },
          select: { mediaAttempts: true },
        })
        .catch(() => null);
      if (updated && updated.mediaAttempts >= MEDIA_MAX_ATTEMPTS) {
        await this.prisma.whatsAppMessage
          .update({ where: { id: messageId }, data: { mediaStatus: 'failed' } })
          .catch(() => undefined);
      }
      this.logger.warn(
        `media for message ${messageId} failed (attempt ${updated?.mediaAttempts ?? '?'}): ${String(err)}`,
      );
    } finally {
      this.mediaInFlight.delete(messageId);
    }
  }

  /**
   * The download the webhook started is fire-and-forget, so a restart mid-download
   * strands a `pending` row. This picks those up; `mediaAttempts` bounds the retries.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryPendingMedia(): Promise<void> {
    if (this.mediaSweepRunning) return;
    this.mediaSweepRunning = true;
    try {
      const now = Date.now();
      await this.prisma.whatsAppMessage.updateMany({
        where: {
          mediaStatus: 'pending',
          createdAt: { lt: new Date(now - MEDIA_RETENTION_MS) },
        },
        data: { mediaStatus: 'failed' },
      });
      const rows = await this.prisma.whatsAppMessage.findMany({
        where: {
          mediaStatus: 'pending',
          mediaAttempts: { lt: MEDIA_MAX_ATTEMPTS },
          createdAt: { lt: new Date(now - MEDIA_RETRY_AFTER_MS) },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
        take: MEDIA_SWEEP_BATCH,
      });
      for (const row of rows) await this.fetchMedia(row.id);
    } catch (err) {
      this.logger.warn(`media sweep failed: ${String(err)}`);
    } finally {
      this.mediaSweepRunning = false;
    }
  }

  /** The file behind a message, for the streaming route. */
  async mediaFile(
    messageId: number,
    variant: 'original' | 'playback',
  ): Promise<{ absolutePath: string; mimeType: string; filename: string }> {
    const row = await this.prisma.whatsAppMessage.findUnique({
      where: { id: messageId },
    });
    if (!row || (!row.mediaId && !row.storagePath)) {
      throw new NotFoundException('Media not found');
    }
    if (!row.storagePath) {
      if (row.mediaStatus === 'pending') {
        void this.fetchMedia(row.id).catch(() => undefined);
      }
      throw new NotFoundException(
        row.mediaStatus === 'failed'
          ? 'This file could not be downloaded from WhatsApp'
          : 'This file is still being downloaded',
      );
    }

    const filename = mediaFilename(
      row.type,
      row.filename,
      row.id,
      row.mimeType,
    );
    if (variant === 'playback' && row.playbackPath) {
      return {
        absolutePath: resolveStoredPath(row.playbackPath),
        mimeType: 'audio/mpeg',
        filename: `${filename.replace(/\.[^.]+$/, '')}.mp3`,
      };
    }
    return {
      absolutePath: resolveStoredPath(row.storagePath),
      mimeType: baseMime(row.mimeType) ?? 'application/octet-stream',
      filename,
    };
  }

  private async store(bytes: Buffer, ext: string): Promise<string> {
    const relative = `${WHATSAPP_SUBDIR}/${randomUUID()}${ext}`;
    const absolute = resolveStoredPath(relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, bytes);
    return relative;
  }

  /**
   * mp3 + duration in one ffmpeg run (the phone-audio trick: the last `time=` in stderr
   * is the length). Best-effort — a failed transcode leaves the original playable in
   * browsers that can, rather than failing the download.
   */
  private async makePlayback(
    bytes: Buffer,
  ): Promise<{ mp3: Buffer | null; durationSec: number | null }> {
    try {
      const { stdout, stderr, code } = await runFfmpegDetailed(
        bytes,
        WHATSAPP_PLAYBACK_MP3_ARGS,
      );
      if (code !== 0 || !stdout.length) {
        this.logger.warn(
          `playback transcode exited ${code}: ${stderr.slice(-300)}`,
        );
        return { mp3: null, durationSec: null };
      }
      const ms = parseDurationMs(stderr);
      return {
        mp3: stdout,
        durationSec: ms > 0 ? Math.max(1, Math.round(ms / 1000)) : null,
      };
    } catch (err) {
      this.logger.warn(`playback transcode failed: ${String(err)}`);
      return { mp3: null, durationSec: null };
    }
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  /** Keyset page, newest first, on `id desc` — autoincrement orders like arrival. */
  async getTimeline(
    companyId: number,
    cursor: number | undefined,
    limit: number,
  ): Promise<WhatsAppTimelineResult> {
    const [account, rows, names] = await Promise.all([
      this.prisma.whatsAppAccount.findUnique({
        where: { companyId },
        select: { id: true },
      }),
      this.prisma.whatsAppMessage.findMany({
        where: { companyId, ...(cursor ? { id: { lt: cursor } } : {}) },
        orderBy: { id: 'desc' },
        take: limit + 1,
      }),
      this.contactNames(companyId),
    ]);
    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    return {
      items: page.map((row) => toItem(row, names)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
      hasMore,
      connected: account !== null,
    };
  }

  /** The conversation with one customer, oldest first, plus whether a reply may be sent. */
  async getThread(
    companyId: number,
    rawPeer: string,
  ): Promise<WhatsAppThreadResult> {
    const peer = normalizeWaId(rawPeer);
    if (!peer) throw new BadRequestException('peer must be a WhatsApp number');

    const [account, rows, lastInbound, names] = await Promise.all([
      this.prisma.whatsAppAccount.findUnique({
        where: { companyId },
        select: { id: true },
      }),
      this.prisma.whatsAppMessage.findMany({
        where: { companyId, peerWaId: peer },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: THREAD_LIMIT,
      }),
      this.lastInbound(companyId, peer),
      this.contactNames(companyId),
    ]);

    return {
      messages: rows.reverse().map((row) => toItem(row, names)),
      peer,
      peerName: names.get(peer) ?? lastInbound?.profileName ?? null,
      windowOpenUntil:
        windowOpenUntil(lastInbound?.at ?? null)?.toISOString() ?? null,
      connected: account !== null,
    };
  }

  async getCounts(companyId: number): Promise<WhatsAppCounts> {
    const [unread, uncompleted] = await Promise.all([
      this.prisma.whatsAppMessage.count({
        where: { companyId, direction: 'inbound', readAt: null },
      }),
      this.prisma.whatsAppMessage.count({
        where: { companyId, direction: 'inbound', completedAt: null },
      }),
    ]);
    return { unread, uncompleted };
  }

  /**
   * The dashboard's per-company WhatsApp contribution. One indexed query, so no cache.
   *
   * A company with a connected number and nothing pending gets an explicit 0 — an ABSENT
   * key means "unknown" to the dashboard, which draws no badge for it.
   */
  async getUncompletedCountsForAll(): Promise<Record<number, number>> {
    const [accounts, grouped] = await Promise.all([
      this.prisma.whatsAppAccount.findMany({
        where: { company: { deletedAt: null } },
        select: { companyId: true },
      }),
      this.prisma.whatsAppMessage.groupBy({
        by: ['companyId'],
        where: {
          direction: 'inbound',
          completedAt: null,
          company: { deletedAt: null },
        },
        _count: { _all: true },
      }),
    ]);
    const out: Record<number, number> = {};
    for (const a of accounts) out[a.companyId] = 0;
    for (const g of grouped) out[g.companyId] = g._count._all;
    return out;
  }

  /** Newest unread inbound messages, for the notification bell. */
  async getUnreadItems(
    companyId: number,
    limit: number,
  ): Promise<WhatsAppItemDto[]> {
    const [rows, names] = await Promise.all([
      this.prisma.whatsAppMessage.findMany({
        where: { companyId, direction: 'inbound', readAt: null },
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.contactNames(companyId),
    ]);
    return rows.map((row) => toItem(row, names));
  }

  // ── Writes ───────────────────────────────────────────────────────────────

  async setState(
    companyId: number,
    messageId: number,
    action: WhatsAppStateAction,
  ): Promise<void> {
    const row = await this.prisma.whatsAppMessage.findFirst({
      where: { id: messageId, companyId },
      select: { id: true, direction: true },
    });
    if (!row) throw new NotFoundException('Message not found');
    // An outbound message is read and completed by construction; there is no state to flip.
    if (row.direction === 'outbound') return;

    const now = new Date();
    const data =
      action === 'read'
        ? { readAt: now }
        : action === 'unread'
          ? { readAt: null }
          : action === 'complete'
            ? { completedAt: now }
            : { completedAt: null };
    await this.prisma.whatsAppMessage.update({ where: { id: row.id }, data });
  }

  async sendText(
    companyId: number,
    to: string,
    body: string,
    userId: number,
  ): Promise<WhatsAppItemDto> {
    const peer = normalizeWaId(to);
    if (!peer) throw new BadRequestException('to must be a WhatsApp number');
    const text = body.trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (text.length > 4096) {
      throw new BadRequestException(
        'WhatsApp messages are limited to 4096 characters',
      );
    }

    const { account, token } = await this.accounts.requireActive(companyId);
    const last = await this.assertWindowOpen(companyId, peer);

    let wamid: string;
    try {
      wamid = await this.graph.sendText(
        account.phoneNumberId,
        token,
        peer,
        text,
      );
    } catch (err) {
      toHttpError(err);
    }

    const now = new Date();
    const row = await this.prisma.whatsAppMessage.create({
      data: {
        companyId,
        phoneNumberId: account.phoneNumberId,
        wamid,
        direction: 'outbound',
        peerWaId: peer,
        profileName: last.profileName,
        type: 'text',
        body: text,
        status: 'sent',
        sentById: userId,
        at: now,
        readAt: now,
        completedAt: now,
      },
    });
    return toItem(row, await this.contactNames(companyId));
  }

  /**
   * Record in the browser -> Ogg/Opus -> upload to Meta -> send as audio.
   *
   * Opus in Ogg is the only format WhatsApp renders as a VOICE NOTE; the browser's webm or
   * mp4 would arrive as an audio file. An mp3 is made too, so our own bubble plays in
   * Safari. Files are written AFTER the send succeeds — a failed send stores nothing.
   */
  async sendVoice(
    companyId: number,
    to: string,
    file: UploadedVoice,
    userId: number,
  ): Promise<WhatsAppItemDto> {
    const peer = normalizeWaId(to);
    if (!peer) throw new BadRequestException('to must be a WhatsApp number');
    if (!file.buffer?.length)
      throw new BadRequestException('The recording is empty');

    const { account, token } = await this.accounts.requireActive(companyId);
    const last = await this.assertWindowOpen(companyId, peer);

    let ogg: Buffer;
    try {
      ogg = await runFfmpeg(file.buffer, WHATSAPP_VOICE_ARGS);
    } catch (err) {
      this.logger.warn(
        `voice transcode failed (${file.mimetype}): ${String(err)}`,
      );
      throw new BadRequestException('That recording could not be processed');
    }
    if (ogg.length > MAX_VOICE_BYTES) {
      throw new BadRequestException('The recording is too long to send');
    }
    const playback = await this.makePlayback(ogg);

    let mediaId: string;
    let wamid: string;
    try {
      mediaId = await this.graph.uploadMedia(
        account.phoneNumberId,
        token,
        ogg,
        'audio/ogg',
        'voice-message.ogg',
      );
      wamid = await this.graph.sendAudio(
        account.phoneNumberId,
        token,
        peer,
        mediaId,
      );
    } catch (err) {
      toHttpError(err);
    }

    // The message is already sent. If our disk write fails, keep the row `pending` with
    // Meta's media id so the sweep downloads our own upload back instead of losing it.
    let storagePath: string | null = null;
    let playbackPath: string | null = null;
    try {
      storagePath = await this.store(ogg, '.ogg');
      if (playback.mp3) playbackPath = await this.store(playback.mp3, '.mp3');
    } catch (err) {
      this.logger.error(
        `storing sent voice note ${wamid} failed: ${String(err)}`,
      );
    }

    const now = new Date();
    const row = await this.prisma.whatsAppMessage.create({
      data: {
        companyId,
        phoneNumberId: account.phoneNumberId,
        wamid,
        direction: 'outbound',
        peerWaId: peer,
        profileName: last.profileName,
        type: 'audio',
        mediaId,
        mimeType: 'audio/ogg',
        size: ogg.length,
        storagePath,
        playbackPath,
        mediaStatus: storagePath ? 'ready' : 'pending',
        isVoice: true,
        durationSec: playback.durationSec,
        status: 'sent',
        sentById: userId,
        at: now,
        readAt: now,
        completedAt: now,
      },
    });
    return toItem(row, await this.contactNames(companyId));
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private lastInbound(companyId: number, peer: string) {
    return this.prisma.whatsAppMessage.findFirst({
      where: { companyId, peerWaId: peer, direction: 'inbound' },
      orderBy: { at: 'desc' },
      select: { at: true, profileName: true },
    });
  }

  /**
   * Meta rejects free-form messages outside the 24h window with error 131047 — AFTER the
   * upload, for a voice note. Checking first gives a clear answer and spends nothing.
   */
  private async assertWindowOpen(
    companyId: number,
    peer: string,
  ): Promise<{ profileName: string | null }> {
    const last = await this.lastInbound(companyId, peer);
    if (!isWindowOpen(last?.at ?? null, new Date())) {
      throw new BadRequestException(
        last
          ? 'The 24-hour reply window is closed. WhatsApp only allows an approved template until the customer writes again.'
          : 'This customer has not messaged this number yet. WhatsApp only allows an approved template as the first message.',
      );
    }
    return { profileName: last?.profileName ?? null };
  }

  /** Saved contact names keyed by digits, so a WhatsApp id matches a stored E.164. */
  private async contactNames(companyId: number): Promise<Map<string, string>> {
    try {
      const rows = await this.prisma.contact.findMany({
        where: { companyId, deletedAt: null, phoneE164: { not: null } },
        select: { phoneE164: true, name: true },
        orderBy: { name: 'asc' },
      });
      return new Map(
        rows.map((r) => [r.phoneE164!.replace(/\D/g, ''), r.name]),
      );
    } catch (err) {
      this.logger.warn(`contactNames(${companyId}) failed: ${String(err)}`);
      return new Map();
    }
  }
}
