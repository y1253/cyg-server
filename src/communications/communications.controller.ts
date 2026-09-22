import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { GmailService } from '../gmail/gmail.service.js';
import { MicrosoftService } from '../microsoft/microsoft.service.js';
import { ProviderResolverService } from './provider-resolver.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { InternalMessagesService } from '../internal-messages/internal-messages.service.js';
import { InternalCallsService } from '../internal-calls/internal-calls.service.js';
import { PhoneTimelineService } from '../phone/phone-timeline.service.js';
import { assertOwnCompany, listOwnCompanies } from './company-access.util.js';
import { UnreadFeedService } from './unread-feed.service.js';
import { WhatsAppMessagesService } from '../whatsapp/whatsapp-messages.service.js';
import { MessageStateService } from './message-state.service.js';
import { idsUpTo } from './complete-until.util.js';
import { AiDocumentService } from '../ai/ai-document.service.js';
import { aiAssist } from '../ai/ai.config.js';
import { mimeForFilename } from '../ai/document-kind.util.js';
import { pool, GMAIL_GET_CONCURRENCY } from './pool.util.js';
import {
  CompleteUntilChatDto,
  CompleteUntilEmailDto,
  CompleteUntilIdDto,
  CompleteUntilSmsDto,
} from './dto/complete-until.dto.js';
import type { LatestPreviewDto } from './communications.types.js';
import type { InboxSummaryDto } from './unread-feed.types.js';

/**
 * Provider-agnostic Communications endpoints that span all companies regardless of
 * which provider each connected. Per-company reads still go to the provider-specific
 * `/api/gmail/*` and `/api/microsoft/*` controllers; the client picks that base from
 * the `provider` on the account returned here.
 */
@Controller('communications')
@UseGuards(JwtAuthGuard)
export class CommunicationsController {
  constructor(
    private readonly gmail: GmailService,
    private readonly microsoft: MicrosoftService,
    private readonly resolver: ProviderResolverService,
    private readonly internal: InternalMessagesService,
    private readonly internalCalls: InternalCallsService,
    private readonly phoneTimeline: PhoneTimelineService,
    private readonly unreadFeed: UnreadFeedService,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppMessagesService,
    private readonly state: MessageStateService,
    // ⚠️ APPENDED, not inserted. `inbox-summary.spec.ts` constructs this class positionally
    // with `new`, so adding a parameter anywhere but the end silently shifts every
    // argument after it — which is a passing typecheck and fourteen failing tests.
    private readonly aiDocuments: AiDocumentService,
  ) {}

  /**
   * The company's connected communications account (whichever provider). The client
   * fetches this first, then routes every other request to `/api/gmail/*` or
   * `/api/microsoft/*` based on `account.provider`.
   *
   * 404s when nothing is connected, matching the per-provider routes
   * (`GmailService.getAccount`, `MicrosoftService.getAccount`). It must not return
   * `null`: Nest sends a nil return as a 200 with a zero-length body, which is not
   * valid JSON, so every client parsing the response threw on it.
   */
  @Get('companies/:companyId/account')
  async account(@Param('companyId', ParseIntPipe) companyId: number) {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) {
      throw new NotFoundException('No communications account connected');
    }
    return provider.getAccount(companyId);
  }

  /**
   * Newest inbox item for a company, as a popup body. Fetched lazily by the client
   * the moment a new-message alert fires — the count map that detects the arrival
   * carries integers only, so the content has to come from somewhere.
   *
   * Authorized by assignment, NOT by the "admin sees all" rule used elsewhere: this
   * route exists only to fill a notification that an unassigned admin never gets.
   * Returns null (200) rather than throwing when the lookup fails, so a broken
   * mailbox downgrades the popup instead of losing it.
   */
  @Get('companies/:companyId/latest-preview')
  async latestPreview(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Request() req: { user: { userId: number } },
  ): Promise<LatestPreviewDto | null> {
    await assertOwnCompany(this.prisma, companyId, req.user.userId);
    const provider = await this.resolver.resolve(companyId);
    if (!provider) return null;
    return provider.getLatestPreview(companyId);
  }

  /**
   * Everything the app's two cross-company surfaces need, in ONE request: the
   * dashboard's per-company uncompleted badge, and the notification bell's unread feed.
   *
   * ⚠️ TWO SCOPES IN ONE RESPONSE, deliberately. `uncompleted` is GLOBAL — the dashboard
   * draws a badge for every company it lists. `unread` is ASSIGNMENT-SCOPED, by the same
   * rule as the new-message popup, because the bell must only interrupt somebody about
   * their own work. "Making them consistent" would either leak other people's mail into
   * the bell or blank the dashboard's badges; `inbox-summary.spec.ts` pins it.
   *
   * It replaced `GET /uncompleted-counts` rather than sitting beside it: two endpoints
   * meant two 60s polls sweeping the same companies, and the phone reads below only
   * share a cache window when they happen in one request.
   *
   * ── The uncompleted half ───────────────────────────────────────────────────
   *
   * The three channel maps are merged by UNION WITH SUMMATION, not by spreading. A
   * company can appear in more than one — a mailbox and a support number both feed the
   * same row — and spreading would silently let the last source win, hiding whichever
   * backlog it overwrote. That is the bug this shape exists to prevent: phone-only
   * companies previously had no key at all, and `CompanyRow` draws no badge for a
   * missing key, so pending calls and texts were invisible from the dashboard.
   *
   * A company still ABSENT from all three means "unknown" (a revoked token, a failed
   * sweep), which the client renders as no badge — deliberately different from 0.
   *
   * Two things about the phone half worth knowing when reading the number: it counts
   * OUTBOUND calls and texts too (outbound is implicitly read, but not implicitly
   * completed), and it is limited to the last 30 days, while the mailbox count is not.
   */
  @Get('inbox-summary')
  async inboxSummary(
    @Request() req: { user: { userId: number } },
  ): Promise<InboxSummaryDto> {
    const [
      g,
      m,
      p,
      w,
      workspace,
      internalCount,
      internalCallCounts,
      feed,
      missedPhone,
      ownCompanies,
    ] = await Promise.all([
      this.gmail.getUncompletedCounts(),
      this.microsoft.getUncompletedCounts(),
      this.phoneTimeline.getUncompletedCountsForAll(),
      // One indexed DB query (WhatsApp is persisted, not fetched), so no cache.
      this.whatsapp.getUncompletedCountsForAll(),
      this.prisma.company.findUnique({
        where: { internalOwnerId: req.user.userId },
        select: { id: true },
      }),
      this.internal.getUncompletedCount(req.user.userId),
      this.internalCalls.counts(req.user.userId),
      // In the SAME Promise.all as the phone count sweep, which is load-bearing: both
      // read PhoneTimelineService's 45s head window, so running them together makes the
      // second a cache hit. Split across two endpoints or two polls and a 45s window
      // starts missing two ~55s callers, roughly doubling SignalWire traffic.
      this.unreadFeed.forUser(req.user.userId),
      // Same sweep and cache as the uncompleted phone map above — no extra traffic.
      this.phoneTimeline.getMissedUnreadCountsForAll(),
      // The bell's scope, for the browser tab badge. The same query the feed runs;
      // calling the rule rather than re-deriving it keeps the two scopes identical.
      listOwnCompanies(this.prisma, req.user.userId),
    ]);

    const merged: Record<number, number> = {};
    for (const source of [g, m, p, w]) {
      for (const [id, n] of Object.entries(source)) {
        merged[Number(id)] = (merged[Number(id)] ?? 0) + n;
      }
    }
    // The workspace now has TWO channels — messages and staff-to-staff calls, merged
    // into one inbox — so this is a sum like every other company, not the assignment it
    // used to be. An assignment here would silently hide whichever backlog it overwrote,
    // which is the same trap the union-with-summation loop above exists to avoid.
    //
    // No `?? 0` needed on the left: a workspace id can never appear in g/m/p (it has no
    // mailbox and no support number), but the addition is written to survive that
    // stopping being true.
    if (workspace) {
      merged[workspace.id] =
        (merged[workspace.id] ?? 0) +
        internalCount +
        internalCallCounts.uncompleted;
    }

    // Missed calls have exactly one source per company: the support number for a client
    // company, staff-to-staff calls for the workspace. Copied, not summed, for the phone
    // half; the workspace is still ADDED so it survives ever gaining a number. A company
    // the sweep did not report stays absent — unknown, not zero.
    const missedCalls: Record<number, number> = { ...missedPhone };
    if (workspace) {
      missedCalls[workspace.id] =
        (missedCalls[workspace.id] ?? 0) + internalCallCounts.missedUnread;
    }
    const missedCallsOwn = ownCompanies.reduce(
      (n, c) => n + (missedCalls[c.id] ?? 0),
      0,
    );

    return {
      uncompleted: merged,
      missedCalls,
      missedCallsOwn,
      unread: feed.items,
      truncated: feed.truncated,
      failed: feed.failed,
    };
  }

  // ── "Complete till here" ────────────────────────────────────────────────────
  //
  // Open a conversation, click one message, and everything up to and including it is
  // marked complete. Five channels, one shape: the client names an ANCHOR and the server
  // enumerates the thread itself (see `CompleteUntilEmailDto` for why the client's own
  // list is not trusted), cuts it with `idsUpTo`, and writes once.
  //
  // They live together in THIS controller rather than four routes scattered across the
  // provider controllers for two reasons: it already injects every service they need, and
  // the email/chat pair would otherwise have to be written twice — once in
  // `gmail.controller.ts` and once in `microsoft.controller.ts` — which is how two copies
  // of a non-trivial enumerate step eventually disagree. `ProviderResolverService` picks
  // the mailbox, exactly as every other cross-provider read here does.
  //
  // Every one answers `{ completed }` — how many rows the write actually changed, which
  // the client reports back rather than guessing from its own capped view.

  @Patch('companies/:companyId/emails/complete-until')
  async completeEmailsUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilEmailDto,
  ): Promise<{ completed: number }> {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) throw new NotFoundException('No mailbox is connected');
    const thread = await provider.getEmailThread(companyId, dto.threadId);
    const ids = idsUpTo(
      thread.messages.map((m) => ({ id: m.id, at: m.date })),
      dto.messageId,
    );
    if (!ids)
      throw new NotFoundException('That message is not in this conversation');
    await this.state.flushCompleted(companyId, ids);
    return { completed: ids.length };
  }

  @Patch('companies/:companyId/chats/complete-until')
  async completeChatsUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilChatDto,
  ): Promise<{ completed: number }> {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) throw new NotFoundException('No mailbox is connected');
    const thread = await provider.getChatThread(companyId, dto.spaceId);
    const ids = idsUpTo(
      thread.messages.map((m) => ({ id: m.id, at: m.createTime })),
      dto.messageId,
    );
    if (!ids)
      throw new NotFoundException('That message is not in this conversation');
    await this.state.flushCompleted(companyId, ids);
    return { completed: ids.length };
  }

  @Patch('companies/:companyId/sms/complete-until')
  async completeSmsUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilSmsDto,
  ): Promise<{ completed: number }> {
    const thread = await this.phoneTimeline.getSmsThread(companyId, dto.peer);
    const ids = idsUpTo(thread.messages, dto.itemId);
    if (!ids)
      throw new NotFoundException('That message is not in this conversation');
    await this.state.flushCompleted(companyId, ids);
    // ONCE, not once per message: every per-item phone mark route awaits this, so the
    // loop the client used to run paid for a full recount per row.
    await this.phoneTimeline.refreshCompanyCounts(companyId);
    this.phoneTimeline.bust(companyId);
    return { completed: ids.length };
  }

  @Patch('companies/:companyId/whatsapp/complete-until')
  async completeWhatsAppUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilIdDto,
  ): Promise<{ completed: number }> {
    return this.whatsapp.completeUntil(companyId, dto.messageId);
  }

  @Patch('internal-messages/complete-until')
  async completeInternalUntil(
    @Body() dto: CompleteUntilIdDto,
    @Request() req: { user: { userId: number } },
  ): Promise<{ completed: number }> {
    return this.internal.completeUntil(dto.messageId, req.user.userId);
  }

  // ── "Read till here" ───────────────────────────────────────────────────────
  //
  // The same five shapes, the same anchors, the same `idsUpTo` cut — writing read state
  // instead of completed state. Deliberately routes of their own rather than an `action`
  // parameter on the five above: each channel stores read in a DIFFERENT place from
  // completed (chat and texts share `ChatMessageReadState`; WhatsApp has a column; internal
  // has a per-recipient row; and EMAIL has no local store at all), so a shared route would
  // be a switch in every body with nothing actually shared above it.
  //
  // ⚠️ They answer `{ completed }` too, reusing `CompleteUntilResult` on the client. The
  // field name is about the SHAPE, not the verb — renaming it per action would fork the
  // client's one mutation hook for nothing.

  @Patch('companies/:companyId/emails/read-until')
  async readEmailsUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilEmailDto,
  ): Promise<{ completed: number }> {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) throw new NotFoundException('No mailbox is connected');
    const thread = await provider.getEmailThread(companyId, dto.threadId);
    const ids = idsUpTo(
      thread.messages.map((m) => ({ id: m.id, at: m.date })),
      dto.messageId,
    );
    if (!ids)
      throw new NotFoundException('That message is not in this conversation');

    /**
     * ⚠️ EMAIL IS THE ONE CHANNEL THIS COSTS N CALLS.
     *
     * Read state for a mailbox lives on the PROVIDER — Gmail's `UNREAD` label, Graph's
     * `isRead` — not in any table of ours, so there is no bulk write to make. That is
     * also why this is the only one of the five that can partially succeed.
     *
     * Pooled at Gmail's documented safe concurrency rather than `Promise.all`, for the
     * reason `pool.util.ts` gives: a wide burst 429s and googleapis backs off, which is
     * slower than the pool it was trying to beat. Each failure is swallowed and simply
     * not counted — a thread where three of forty would not mark should still mark the
     * thirty-seven, and the count the user sees is the truth rather than the intent.
     */
    const results = await pool(ids, GMAIL_GET_CONCURRENCY, (id) =>
      provider.markAsRead(companyId, id).then(
        () => true,
        () => false,
      ),
    );
    // ⚠️ `unreadIds` is cached for 10s and EVERY list row's `isRead` derives from it, so
    // without this the thread goes read while the inbox behind it still shows bold rows.
    // Both per-item mark routes already do it. A no-op for an Outlook company, whose
    // `isRead` comes straight off the message payload.
    this.gmail.bustUnread(companyId);
    this.unreadFeed.bust(companyId);
    return { completed: results.filter(Boolean).length };
  }

  @Patch('companies/:companyId/chats/read-until')
  async readChatsUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilChatDto,
  ): Promise<{ completed: number }> {
    const provider = await this.resolver.resolve(companyId);
    if (!provider) throw new NotFoundException('No mailbox is connected');
    const thread = await provider.getChatThread(companyId, dto.spaceId);
    const ids = idsUpTo(
      thread.messages.map((m) => ({ id: m.id, at: m.createTime })),
      dto.messageId,
    );
    if (!ids)
      throw new NotFoundException('That message is not in this conversation');
    await this.state.flushRead(companyId, ids);
    this.unreadFeed.bust(companyId);
    return { completed: ids.length };
  }

  @Patch('companies/:companyId/sms/read-until')
  async readSmsUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilSmsDto,
  ): Promise<{ completed: number }> {
    const thread = await this.phoneTimeline.getSmsThread(companyId, dto.peer);
    const ids = idsUpTo(thread.messages, dto.itemId);
    if (!ids)
      throw new NotFoundException('That message is not in this conversation');
    await this.state.flushRead(companyId, ids);
    // ONCE, for the same reason the completion twin does it once: the unread half of the
    // badge is what just moved, and a per-row recount would be N sweeps of SignalWire.
    await this.phoneTimeline.refreshCompanyCounts(companyId);
    this.phoneTimeline.bust(companyId);
    this.unreadFeed.bust(companyId);
    return { completed: ids.length };
  }

  @Patch('companies/:companyId/whatsapp/read-until')
  async readWhatsAppUntil(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Body() dto: CompleteUntilIdDto,
  ): Promise<{ completed: number }> {
    const result = await this.whatsapp.readUntil(companyId, dto.messageId);
    this.unreadFeed.bust(companyId);
    return result;
  }

  // ── AI: summarising an attachment ──────────────────────────────────────────
  //
  // One route per channel, each reusing that channel's OWN ownership proof, with the
  // model work in `AiDocumentService`, which knows nothing about channels. That split is
  // the `CallSummary` rule: a single shared endpoint would need a second guard to keep in
  // step with the five that already exist, which is how two guards eventually disagree.
  //
  // This one covers BOTH mailboxes, through the resolver — the same reason the email
  // complete-until route lives here rather than twice in the provider controllers.

  @Post('companies/:companyId/emails/:messageId/attachments/:attachmentId/summarize')
  async summarizeEmailAttachment(
    @Param('companyId', ParseIntPipe) companyId: number,
    @Param('messageId') messageId: string,
    @Param('attachmentId') attachmentId: string,
    @Query('filename') filename?: string,
    @Query('size') size?: string,
    @Request() req?: { user: { userId: number } },
  ): Promise<{ summary: string }> {
    if (!aiAssist(process.env)) {
      throw new BadRequestException('AI assistance is switched off.');
    }
    // A read that BILLS. `assertOwnCompany` rather than the module's usual
    // any-authenticated-user read tier: it is the rule `latestPreview` uses on this same
    // controller, and an unassigned admin should not be able to spend the firm's OpenAI
    // budget reading a company's post.
    await assertOwnCompany(this.prisma, companyId, req!.user.userId);

    const provider = await this.resolver.resolve(companyId);
    if (!provider) throw new NotFoundException('No mailbox is connected');

    const parsedSize = Number.parseInt(size ?? '', 10);
    const bytes = await provider.getEmailAttachment(
      companyId,
      messageId,
      attachmentId,
      filename && Number.isFinite(parsedSize)
        ? { filename, size: parsedSize }
        : undefined,
    );
    return this.aiDocuments.summarize({
      bytes,
      mimeType: mimeForFilename(filename ?? ''),
      filename: filename ?? 'attachment',
    });
  }

  @Patch('internal-messages/read-until')
  async readInternalUntil(
    @Body() dto: CompleteUntilIdDto,
    @Request() req: { user: { userId: number } },
  ): Promise<{ completed: number }> {
    return this.internal.readUntil(dto.messageId, req.user.userId);
  }
}
