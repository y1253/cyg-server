import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { InternalMessagesService } from '../internal-messages/internal-messages.service.js';
import { InternalCallsService } from '../internal-calls/internal-calls.service.js';
import { PhoneTimelineService } from '../phone/phone-timeline.service.js';
import { listOwnCompanies } from './company-access.util.js';
import { pool } from './pool.util.js';
import {
  PER_COMPANY_CAP,
  type UnreadFeedFailure,
  type UnreadFeedItemDto,
  type UnreadFeedResult,
} from './unread-feed.types.js';
import {
  chatToFeedItem,
  emailToFeedItem,
  internalCallToFeedItem,
  internalMessageToFeedItem,
  mergeUnreadFeed,
  phoneToFeedItem,
  type CompanyGroup,
  type InternalCallRow,
  type InternalMessageRow,
} from './unread-feed.util.js';
import type { CommunicationsProvider } from './provider.interface.js';

/**
 * The unread half of `GET /communications/inbox-summary` — the notification bell's feed.
 *
 * Scoped by `listOwnCompanies`, i.e. the same assignment rule as the new-message popup,
 * so the bell and the popup can never disagree about whose mail it is. An admin assigned
 * to nothing gets an empty feed on purpose.
 *
 * Returns only its own half; the controller merges it with the dashboard's global
 * uncompleted map. That split is deliberate — this service never learns the other
 * metric exists, so nothing here can be tempted to reconcile the two scopes.
 */
@Injectable()
export class UnreadFeedService {
  private readonly logger = new Logger(UnreadFeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gmail: GmailService,
    private readonly microsoft: MicrosoftService,
    private readonly internal: InternalMessagesService,
    private readonly internalCalls: InternalCallsService,
    private readonly phoneTimeline: PhoneTimelineService,
  ) {}

  /**
   * ── WHY ITS OWN CACHE ──────────────────────────────────────────────────────
   * Not `MessageStateService`'s: that cache is keyed on companyId alone and is already
   * occupied by the mailbox's uncompleted count, so a second caller would race it and
   * both would read whichever landed first — the exact reason
   * `PhoneTimelineService.getCounts` stays out of it too.
   *
   * Entries are keyed by company and are USER-INDEPENDENT: a mailbox's unread state and
   * a company's phone read state belong to the company, not the viewer, so two people
   * assigned the same company share one sweep. Only the internal-workspace rows below
   * are per-user, and those are plain Prisma pages.
   *
   * The TTL sits just under the client's 60s poll so a poll is a miss at most once per
   * cycle; `inFlight` is what stops N signed-in tabs each starting a sweep.
   */
  private itemCache = new Map<
    number,
    { at: number; items: UnreadFeedItemDto[]; failed: boolean }
  >();
  private inFlight = new Map<
    number,
    Promise<{ items: UnreadFeedItemDto[]; failed: boolean }>
  >();
  private static readonly TTL_MS = 55_000;
  private static readonly MAX_ENTRIES = 300;
  private static readonly CONCURRENCY = 4;

  async forUser(userId: number): Promise<UnreadFeedResult> {
    const companies = await listOwnCompanies(this.prisma, userId);
    const clients = companies.filter((c) => !c.isInternal);
    const workspace = companies.find((c) => c.isInternal) ?? null;

    const providers = await this.resolveProviders(clients.map((c) => c.id));

    const failed: UnreadFeedFailure[] = [];
    const groups: CompanyGroup[] = [];

    const swept = await pool(clients, UnreadFeedService.CONCURRENCY, (c) =>
      this.companyItems(c.id, c.businessName, providers.get(c.id) ?? null),
    );
    swept.forEach((result, i) => {
      const company = clients[i];
      if (result.failed) {
        failed.push({
          companyId: company.id,
          companyName: company.businessName,
        });
      }
      if (result.items.length > 0) {
        groups.push({ companyId: company.id, items: result.items });
      }
    });

    if (workspace) {
      const internalItems = await this.workspaceItems(
        userId,
        workspace.id,
        workspace.businessName,
      );
      if (internalItems.length > 0) {
        groups.push({ companyId: workspace.id, items: internalItems });
      }
    }

    const { items, truncated } = mergeUnreadFeed(groups);
    return { items, truncated, failed };
  }

  /**
   * Which provider each company connected, in two queries rather than two per company.
   *
   * `ProviderResolverService.resolve` is the right primitive for one company and the
   * wrong one for a fan-out: it is 2 lookups each, so a user on twenty companies paid
   * forty queries before a single mailbox was read.
   */
  private async resolveProviders(
    ids: number[],
  ): Promise<Map<number, CommunicationsProvider>> {
    const out = new Map<number, CommunicationsProvider>();
    if (ids.length === 0) return out;
    const [google, microsoft] = await Promise.all([
      this.prisma.gmailAccount.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true },
      }),
      this.prisma.microsoftAccount.findMany({
        where: { companyId: { in: ids } },
        select: { companyId: true },
      }),
    ]);
    for (const row of google) out.set(row.companyId, this.gmail);
    for (const row of microsoft) out.set(row.companyId, this.microsoft);
    return out;
  }

  private async companyItems(
    companyId: number,
    companyName: string,
    provider: CommunicationsProvider | null,
  ): Promise<{ items: UnreadFeedItemDto[]; failed: boolean }> {
    const cached = this.itemCache.get(companyId);
    if (cached && Date.now() - cached.at < UnreadFeedService.TTL_MS) {
      return { items: cached.items, failed: cached.failed };
    }
    const existing = this.inFlight.get(companyId);
    if (existing) return existing;

    const run = this.sweepCompany(companyId, companyName, provider)
      .then((result) => {
        this.remember(companyId, result);
        return result;
      })
      .finally(() => {
        this.inFlight.delete(companyId);
      });
    this.inFlight.set(companyId, run);
    return run;
  }

  /**
   * Each channel is caught on its own, so a revoked mailbox still lets that company's
   * calls and texts through. A channel that fails contributes no rows and flips
   * `failed` — it is never treated as "nothing unread", because the badge may undercount
   * but must never claim an inbox zero it cannot prove.
   */
  private async sweepCompany(
    companyId: number,
    companyName: string,
    provider: CommunicationsProvider | null,
  ): Promise<{ items: UnreadFeedItemDto[]; failed: boolean }> {
    const nowIso = new Date().toISOString();
    const items: UnreadFeedItemDto[] = [];
    let failed = false;

    const [emails, chats, phone] = await Promise.all([
      provider ? this.unreadEmails(companyId, provider) : null,
      provider ? this.unreadChats(companyId, provider) : null,
      this.unreadPhone(companyId),
    ]);

    if (emails === 'failed') failed = true;
    else if (emails) {
      items.push(
        ...emails.map((e) =>
          emailToFeedItem(companyId, companyName, e, nowIso),
        ),
      );
    }

    if (chats === 'failed') failed = true;
    else if (chats) {
      items.push(
        ...chats.map((c) => chatToFeedItem(companyId, companyName, c, nowIso)),
      );
    }

    if (phone === 'failed') failed = true;
    else {
      items.push(
        ...phone.map((p) => phoneToFeedItem(companyId, companyName, p, nowIso)),
      );
    }

    return { items, failed };
  }

  private async unreadEmails(
    companyId: number,
    provider: CommunicationsProvider,
  ) {
    try {
      // INBOX *and* UNREAD together. Bare UNREAD is right for "is this id unread" but
      // as a feed query it lists unread spam and trash.
      const result = await provider.getEmails(companyId, undefined, [
        'INBOX',
        'UNREAD',
      ]);
      if (result.needsReconnect) return 'failed' as const;
      // The label query should already be unread-only; filtering again is cheap and
      // covers a stale entry in the provider's own unread cache.
      return result.messages.filter((m) => !m.isRead).slice(0, PER_COMPANY_CAP);
    } catch (err) {
      this.logger.warn(
        `unread emails failed for company ${companyId}: ${String(err)}`,
      );
      return 'failed' as const;
    }
  }

  private async unreadChats(
    companyId: number,
    provider: CommunicationsProvider,
  ) {
    try {
      const result = await provider.getChats(companyId);
      if (result.needsReconnect) return 'failed' as const;
      return result.messages.filter((m) => !m.isRead).slice(0, PER_COMPANY_CAP);
    } catch (err) {
      this.logger.warn(
        `unread chats failed for company ${companyId}: ${String(err)}`,
      );
      return 'failed' as const;
    }
  }

  private async unreadPhone(companyId: number) {
    try {
      return await this.phoneTimeline.getUnreadItems(
        companyId,
        PER_COMPANY_CAP,
      );
    } catch (err) {
      this.logger.warn(
        `unread phone failed for company ${companyId}: ${String(err)}`,
      );
      return 'failed' as const;
    }
  }

  /**
   * The caller's own workspace — messages and staff-to-staff calls, the two channels
   * that share its inbox. Uncached: both are a single indexed Prisma page, and unlike a
   * mailbox the result is per-user so a shared cache would be wrong anyway.
   *
   * Never throws the request away: a bell missing its internal rows is a worse outcome
   * than a bell, but a 500 is worse than both.
   */
  private async workspaceItems(
    userId: number,
    workspaceId: number,
    workspaceName: string,
  ): Promise<UnreadFeedItemDto[]> {
    const nowIso = new Date().toISOString();
    const [messages, calls] = await Promise.all([
      this.unreadInternalMessages(userId),
      this.unreadInternalCalls(userId),
    ]);

    return [
      ...messages
        .slice(0, PER_COMPANY_CAP)
        .map((m) =>
          internalMessageToFeedItem(workspaceId, workspaceName, m, nowIso),
        ),
      ...calls.map((c) =>
        internalCallToFeedItem(workspaceId, workspaceName, c, nowIso),
      ),
    ];
  }

  private async unreadInternalMessages(
    userId: number,
  ): Promise<InternalMessageRow[]> {
    try {
      const { messages } = await this.internal.list(userId, 'UNREAD');
      return messages;
    } catch (err) {
      this.logger.warn(`unread internal messages failed: ${String(err)}`);
      return [];
    }
  }

  private async unreadInternalCalls(
    userId: number,
  ): Promise<InternalCallRow[]> {
    try {
      const { calls } = await this.internalCalls.list(
        userId,
        'UNREAD',
        undefined,
        PER_COMPANY_CAP,
      );
      return calls;
    } catch (err) {
      this.logger.warn(`unread internal calls failed: ${String(err)}`);
      return [];
    }
  }

  /** Bounded, so a long-lived process cannot grow one entry per company forever. */
  private remember(
    companyId: number,
    result: { items: UnreadFeedItemDto[]; failed: boolean },
  ): void {
    if (this.itemCache.size >= UnreadFeedService.MAX_ENTRIES) {
      const oldest = this.itemCache.keys().next();
      if (!oldest.done) this.itemCache.delete(oldest.value);
    }
    this.itemCache.set(companyId, { at: Date.now(), ...result });
  }
}
