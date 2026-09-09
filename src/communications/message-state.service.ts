import { Injectable, Logger } from '@nestjs/common';
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

  private readonly logger = new Logger(MessageStateService.name);

  /**
   * Turns MySQL's error 1406 into an actionable log line before re-throwing.
   *
   * Under STRICT_TRANS_TABLES an over-long provider id is a thrown error, not a
   * truncation — the PATCH 500s, the client's optimistic update hides it, and the
   * state appears to "revert on refresh". That cost a full debugging cycle once;
   * make the next occurrence name itself.
   */
  private rethrowWithIdWidthHint(
    table: string,
    messageId: string,
    err: unknown,
  ): never {
    const msg = err instanceof Error ? err.message : String(err);
    if (/1406|Data too long/i.test(msg)) {
      this.logger.error(
        `${table}.messageId is too narrow for a ${messageId.length}-char provider id. ` +
          `Fix with: ALTER TABLE ${table} MODIFY messageId VARCHAR(500) NOT NULL;`,
      );
    }
    throw err instanceof Error ? err : new Error(msg);
  }

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

  /**
   * Very short-lived cache over the three per-company state SETS.
   *
   * Rendering one inbox page loads these 3-4 times over -- once for the email
   * list, once for chats, once for the phone timeline -- within about a second
   * of each other. This collapses that to one query per set without making any
   * of them meaningfully stale.
   *
   * ⚠️ The TTL is NOT the freshness mechanism; `bustState` is. Every mutation
   * below calls it, so a user's own click is visible on the very next read. The
   * 5s ceiling only bounds the window in which ANOTHER process's write has not
   * reached this one -- these are per-process maps, so a multi-instance deploy
   * has one view per pod. That is why this is 5s and not 60s.
   */
  private static readonly SET_TTL_MS = 5_000;
  private readonly setCache = new Map<
    string,
    { at: number; set: Set<string> }
  >();
  private readonly setInFlight = new Map<string, Promise<Set<string>>>();

  /**
   * Serves one of the state sets from the short cache, or loads it.
   *
   * The in-flight dedupe is the half that matters most: the three sources fire
   * concurrently, so without it they miss the cache simultaneously and issue the
   * same query three times regardless of the TTL.
   */
  private async cachedSet(
    key: string,
    load: () => Promise<Set<string>>,
  ): Promise<Set<string>> {
    const hit = this.setCache.get(key);
    if (hit && Date.now() - hit.at < MessageStateService.SET_TTL_MS)
      return hit.set;

    const existing = this.setInFlight.get(key);
    if (existing) return existing;

    const promise = load()
      .then((set) => {
        this.setCache.set(key, { at: Date.now(), set });
        return set;
      })
      .finally(() => this.setInFlight.delete(key));

    this.setInFlight.set(key, promise);
    return promise;
  }

  /**
   * Drops every cached state set for a company.
   *
   * Called from EVERY mutation, deliberately over-broadly: over-busting a 5s
   * cache costs one query, while under-busting shows a user their tick coming
   * back, which is the bug this whole layer must not introduce.
   */
  bustState(companyId: number): void {
    for (const kind of ['read', 'completed', 'forwarded'])
      this.setCache.delete(`${kind}:${companyId}`);
  }

  // ─── Chat read state ───────────────────────────────────────────────────────

  /** Marks a single chat message read for the whole company (shared state). */
  async markChatRead(companyId: number, messageId: string): Promise<void> {
    const now = new Date();
    await this.prisma.$executeRaw`
      INSERT INTO ChatMessageReadState (companyId, messageId, readAt, updatedAt)
      VALUES (${companyId}, ${messageId}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE readAt = VALUES(readAt), updatedAt = VALUES(updatedAt)
    `;
    this.bustState(companyId);
  }

  /** Marks a single chat message unread (removes its read row). */
  async markChatUnread(companyId: number, messageId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM ChatMessageReadState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
    this.bustState(companyId);
  }

  /** The set of chat message ids marked read for a company. */
  async getReadSet(companyId: number): Promise<Set<string>> {
    return this.cachedSet(`read:${companyId}`, async () => {
      const rows = await this.prisma.$queryRaw<{ messageId: string }[]>`
        SELECT messageId FROM ChatMessageReadState WHERE companyId = ${companyId}
      `;
      return new Set(rows.map((r) => r.messageId));
    });
  }

  // ─── Completed state (email + chat) ────────────────────────────────────────

  /** Marks a single message (email or chat) completed and busts the count caches. */
  async markComplete(companyId: number, messageId: string): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.$executeRaw`
        INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
        VALUES (${companyId}, ${messageId}, ${now}, ${now})
        ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
      `;
    } catch (err) {
      this.rethrowWithIdWidthHint('MessageCompletedState', messageId, err);
    }
    this.bustUncompleted(companyId);
    this.bustState(companyId);
  }

  /** Clears the completed state for a single message and busts the count caches. */
  async markUncomplete(companyId: number, messageId: string): Promise<void> {
    await this.prisma.$executeRaw`
      DELETE FROM MessageCompletedState WHERE companyId = ${companyId} AND messageId = ${messageId}
    `;
    this.bustUncompleted(companyId);
    this.bustState(companyId);
  }

  /** All completed message ids for a company (callers filter email vs chat). */
  async getCompletedSet(companyId: number): Promise<Set<string>> {
    return this.cachedSet(`completed:${companyId}`, async () => {
      const rows = await this.prisma.$queryRaw<{ messageId: string }[]>`
        SELECT messageId FROM MessageCompletedState WHERE companyId = ${companyId}
      `;
      return new Set(rows.map((r) => r.messageId));
    });
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
      try {
        await this.prisma.$executeRaw`
          INSERT INTO MessageCompletedState (companyId, messageId, completedAt, updatedAt)
          VALUES ${values}
          ON DUPLICATE KEY UPDATE completedAt = VALUES(completedAt), updatedAt = VALUES(updatedAt)
        `;
      } catch (err) {
        const longest = chunk.reduce((a, b) => (b.length > a.length ? b : a));
        this.rethrowWithIdWidthHint('MessageCompletedState', longest, err);
      }
    }
    this.bustUncompleted(companyId);
    this.bustState(companyId);
    return ids.length;
  }

  // ─── Forwarded state (email) ───────────────────────────────────────────────

  /** All forwarded message ids for a company (forwarded ⇔ at least one row). */
  async getForwardedSet(companyId: number): Promise<Set<string>> {
    return this.cachedSet(`forwarded:${companyId}`, async () => {
      const rows = await this.prisma.$queryRaw<{ messageId: string }[]>`
        SELECT messageId FROM ForwardedMessageState WHERE companyId = ${companyId}
      `;
      return new Set(rows.map((r) => r.messageId));
    });
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
    this.bustState(companyId);
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
