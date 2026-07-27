import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Provider-agnostic shared state for the Communications inbox. Every operation is
 * keyed only on `(companyId, messageId)`, so Gmail (Google) and Microsoft (Outlook
 * + Teams) both use this one service:
 *   - chat read/unread  → ChatMessageReadState (a row exists ⇔ read)
 *   - completed         → MessageCompletedState (a row exists ⇔ completed; email + chat)
 *   - forwarded         → ForwardedMessageState (one row per forward event)
 *
 * Message ids are provider-namespaced by the callers so they never collide:
 * Gmail email ids and Outlook message ids have no "/"; Google Chat resource names
 * contain "/"; Teams chat state ids are prefixed "msteams:". Callers that need to
 * separate the email vs chat completed ids pass the appropriate `isChatId` filter.
 */
@Injectable()
export class MessageStateService {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly UNCOMPLETED_TTL_MS = 60_000;
  // Cached uncompleted count per company (busted on mark(un)complete).
  private readonly uncompletedCache = new Map<
    number,
    { count: number; at: number }
  >();
  // Concurrent count computations for the same company share one promise.
  private readonly uncompletedInFlight = new Map<
    number,
    Promise<{ count: number }>
  >();
  // The no-search uncompleted email-id list per company (busted on mark(un)complete).
  private readonly uncompletedIdsCache = new Map<
    number,
    { ids: string[]; at: number }
  >();

  // ─── Chat read state ───────────────────────────────────────────────────────

  /** Marks a single chat message read for the whole company (shared state). */
  async markChatRead(companyId: number, messageId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO ChatMessageReadState (companyId, messageId, readAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE readAt = VALUES(readAt), updatedAt = VALUES(updatedAt)
    `;
  }

  /** Marks a single chat message unread (removes its read row). */
  async markChatUnread(companyId: number, messageId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM ChatMessageReadState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
  }

  /** The set of chat message ids marked read for a company. */
  async getReadSet(companyId: number): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<{ messageId: string }[]>`
      SELECT messageId FROM ChatMessageReadState WHERE companyId = ${companyId}
    `;
    return new Set(rows.map((r) => r.messageId));
  }

  // ─── Completed state (email + chat) ────────────────────────────────────────

  /** Marks a single message (email or chat) completed and busts the count caches. */
  async markComplete(companyId: number, messageId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
    `;
    this.bustUncompleted(companyId);
  }

  /** Clears the completed state for a single message and busts the count caches. */
  async markUncomplete(companyId: number, messageId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM MessageCompletedState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
    this.bustUncompleted(companyId);
  }

  /** All completed message ids for a company (callers filter email vs chat). */
  async getCompletedSet(companyId: number): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<{ messageId: string }[]>`
      SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
    `;
    return new Set(rows.map((r) => r.messageId));
  }

  /**
   * Bulk-upserts message ids into MessageCompletedState, chunked. Idempotent
   * (ON DUPLICATE KEY UPDATE) so the connect-sweep can flush incrementally and be
   * safely re-run. Returns the number of ids written.
   */
  async flushCompleted(companyId: number, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const now = new Date();
    const CHUNK = 200;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const values = Prisma.join(
        chunk.map((id) => Prisma.sql`(${companyId}, ${id}, ${now}, ${now})`),
      );
      await this.prisma.$executeRaw`
        INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
        VALUES ${values}
        ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
      `;
    }
    return ids.length;
  }

  // ─── Forwarded state (email) ───────────────────────────────────────────────

  /** All forwarded message ids for a company (forwarded ⇔ at least one row). */
  async getForwardedSet(companyId: number): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<{ messageId: string }[]>`
      SELECT messageId FROM ForwardedMessageState WHERE companyId = ${companyId}
    `;
    return new Set(rows.map((r) => r.messageId));
  }

  /**
   * Appends a forward event (one row per forward) for a message. `sentMessageId`
   * is the id of the new message that was sent (so the UI can open the full
   * forward); null when the provider didn't return one.
   */
  async recordForward(
    companyId: number,
    messageId: string,
    recipient: string | null,
    sentMessageId: string | null = null,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO ForwardedMessageState (companyId, messageId, recipient, sentMessageId, forwardedAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${recipient}, ${sentMessageId}, ${now}, ${now})
    `;
  }

  /** The forward history for one message, oldest first. */
  async getForwards(
    companyId: number,
    messageId: string,
  ): Promise<
    {
      recipient: string | null;
      forwardedAt: Date;
      sentMessageId: string | null;
    }[]
  > {
    return this.prisma.$queryRaw<
      {
        recipient: string | null;
        forwardedAt: Date;
        sentMessageId: string | null;
      }[]
    >`
      SELECT recipient, forwardedAt, sentMessageId FROM ForwardedMessageState
      WHERE companyId = ${companyId} AND messageId = ${messageId}
      ORDER BY forwardedAt ASC
    `;
  }

  // ─── Uncompleted count cache + dedupe (generic across providers) ────────────

  /** Drops both count caches for a company (call after any completed-state change). */
  bustUncompleted(companyId: number): void {
    this.uncompletedCache.delete(companyId);
    this.uncompletedIdsCache.delete(companyId);
  }

  /**
   * Returns the cached uncompleted count, or runs `compute` (guarded by a TTL and
   * per-company in-flight dedupe) and caches the result. `compute` is the
   * provider-specific tally (open email ids + unread chats).
   */
  async getUncompletedCount(
    companyId: number,
    compute: () => Promise<number>,
  ): Promise<{ count: number }> {
    const cached = this.uncompletedCache.get(companyId);
    if (
      cached &&
      Date.now() - cached.at < MessageStateService.UNCOMPLETED_TTL_MS
    ) {
      return { count: cached.count };
    }

    const inFlight = this.uncompletedInFlight.get(companyId);
    if (inFlight) return inFlight;

    const promise = compute()
      .then((count) => {
        this.uncompletedCache.set(companyId, { count, at: Date.now() });
        return { count };
      })
      .finally(() => this.uncompletedInFlight.delete(companyId));

    this.uncompletedInFlight.set(companyId, promise);
    return promise;
  }

  /**
   * Returns the cached no-search uncompleted email-id list, or runs `compute` and
   * caches it. When `q` is set the cache is bypassed (search results aren't cached).
   */
  async getCachedEmailIds(
    companyId: number,
    q: string | undefined,
    compute: () => Promise<string[]>,
  ): Promise<string[]> {
    if (!q) {
      const cached = this.uncompletedIdsCache.get(companyId);
      if (
        cached &&
        Date.now() - cached.at < MessageStateService.UNCOMPLETED_TTL_MS
      ) {
        return cached.ids;
      }
    }
    const ids = await compute();
    if (!q) this.uncompletedIdsCache.set(companyId, { ids, at: Date.now() });
    return ids;
  }
}
