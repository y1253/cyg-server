import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SmsOptOutService } from './sms-opt-out.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { minRecordingSeconds, sipDialTarget } from './phone.config.js';
import {
  isE164,
  type SwCall,
  type SwMessage,
  type SwRecording,
} from './signalwire-parse.js';
import {
  buildPhoneItems,
  callItemId,
  hideOwnSmsReplies,
  isAudibleRecording,
  isUnreadMissedCall,
  legNumber,
  rowItemIdFor,
  windowHasLiveLeg,
} from './phone-timeline.util.js';
import { pickConnectedChild } from './call-legs.util.js';
import { signRecordingToken } from './recording-token.util.js';
import { signSmsMediaToken } from './sms-media-token.util.js';
import {
  MAX_MMS_FILES,
  MAX_MMS_TOTAL_BYTES,
  MMS_DIR,
  ensureMmsDir,
  signMmsToken,
} from './mms-staging.util.js';
import {
  MMS_IMAGE_LADDER,
  isMmsImage,
  perFileBudget,
} from './mms-shrink.util.js';
import { requirePublicBase } from '../communications/public-base.js';
import { pool } from '../communications/pool.util.js';
import { randomUUID } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';

/**
 * One attachment multer has already written to the MMS staging directory.
 *
 * `derived` collects anything the shrink path writes beside it, so the send's `finally`
 * can remove the re-encoded copy as well as the original — a staging directory that grows
 * is the failure `OutboundCleanupService` exists to catch, and this one holds client
 * documents behind a public route.
 */
export interface StagedMms {
  path: string;
  filename: string;
  mimetype: string;
  size: number;
  derived: string[];
}
import type {
  PhoneCountsDto,
  PhoneCountsMapsDto,
  PhoneItemDto,
  PhoneTimelineResult,
  RecordingDto,
  SmsItemDto,
  SmsThreadResult,
} from './phone.types.js';

/**
 * The company's calls and SMS, fetched live from SignalWire on every page load.
 *
 * Nothing is persisted: `SupportNumber` stays the only phone table, exactly as the
 * spec asked. Read and completed state are the two exceptions, and they reuse the
 * provider-agnostic tables the mailbox already uses.
 *
 * ── WHY ONE PAGE COSTS FIVE REQUESTS ───────────────────────────────────────────
 * The Compatibility API has no "to OR from" filter, so each channel needs one query
 * per direction: Calls?To, Calls?From, Messages?To, Messages?From. The fifth fetches
 * the SIP child legs, which is the ONLY way to tell an answered inbound call from a
 * missed one (see `callOutcome`).
 *
 * The obvious saving — drop the To/From filters and keep only rows matching our
 * number — is deliberately not taken: that pulls every company's traffic on the
 * account through this request, and one slip in the filter is a cross-company leak.
 */
@Injectable()
export class PhoneTimelineService {
  private readonly logger = new Logger(PhoneTimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly signalwire: SignalWireService,
    private readonly state: MessageStateService,
    private readonly optOuts: SmsOptOutService,
  ) {}

  /**
   * How long a fetched window is reused.
   *
   * The inbox polls every 15s per open company, so without this each poll would cost six
   * SignalWire round-trips with 12-15s timeouts apiece.
   *
   * ⚠️ This is NOT the freshness mechanism — `bust()` is. Every event that creates a row
   * already busts: `voice/status` on a finished call, `sms/inbound`, `voice/voicemail`, and
   * our own `sendSms`. The TTL only bounds the case where a webhook was missed or
   * signature-rejected, which is why it can be generous.
   *
   * It was 20s, which read as "slightly above the 15s poll" but is not how the arithmetic
   * works: the check is `age < ttl`, so polls at t=15 hit and t=30 MISSES, then 45 hits and
   * 60 misses — every second poll paid the full fan-out, and that multi-second stall is
   * what made the tab's loading state so visible. 45s misses every third poll instead, for
   * a worst-case staleness of the same order as `COUNTS_ALL_TTL_MS`.
   *
   * ⚠️ The "`bust()` is the freshness mechanism" claim above holds for every event that
   * CREATES a row and fails for the one that CHANGES one — see `windowHasLiveLeg`, and
   * `LIVE_TTL_MS` below, which is the exception carved out for it.
   */
  private static readonly TTL_MS = 45_000;
  /**
   * A window that still contains an unfinished call re-reads itself quickly.
   *
   * 10s, not 5s: below the 15s inbox poll, so every poll while a call is up is a miss,
   * which is the entire point — without multiplying the cost for the 55s cross-company
   * `getCountsForAll` sweep, which shares this same cache. Only a company with a live leg
   * in-window pays it, and a company has one or two.
   */
  private static readonly LIVE_TTL_MS = 10_000;
  /** An older window cannot change, so it is held far longer. */
  private static readonly HISTORIC_TTL_MS = 5 * 60_000;
  /** Bounds the cache: companies × cursors would otherwise grow without limit. */
  private static readonly MAX_ENTRIES = 300;
  /** How far back the folder badges count. See `getCounts`. */
  private static readonly COUNT_WINDOW_MS = 30 * 24 * 60 * 60_000;

  /**
   * How many attachment lists to fetch at once when opening a thread.
   *
   * Lower than the mailbox pools: this is not quota-limited the way Gmail's `messages.get`
   * is, it just should not open twenty sockets to SignalWire because somebody opened a
   * photo-heavy conversation. Most threads have none at all.
   */
  private static readonly SMS_MEDIA_CONCURRENCY = 4;

  private cache = new Map<
    string,
    { at: number; ttl: number; rows: RawWindow }
  >();
  private inFlight = new Map<string, Promise<RawWindow>>();

  /** Drop every cached window for a company. */
  bust(companyId: number): void {
    for (const key of [...this.cache.keys()]) {
      if (key.startsWith(`${companyId}|`)) this.cache.delete(key);
    }
  }

  /** The company's active number, or null. Mirrors `getActiveNumber`. */
  private async activeNumber(companyId: number): Promise<string | null> {
    const row = await this.prisma.supportNumber.findFirst({
      where: { companyId, releasedAt: null },
      orderBy: { id: 'desc' },
      select: { phoneNumber: true },
    });
    return row?.phoneNumber ?? null;
  }

  /**
   * One window of raw legs, cached.
   *
   * `before` is epoch ms. It is sent to SignalWire as a FULL ISO timestamp — the API
   * honours the time and reads a bare date as midnight, so truncating here would drop
   * the cursor's whole day on every page.
   */
  private async loadWindow(
    companyId: number,
    supportNumber: string,
    before: number | undefined,
  ): Promise<RawWindow> {
    const key = `${companyId}|${before ?? 'HEAD'}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.rows;

    const running = this.inFlight.get(key);
    if (running) return running;

    const sipTarget = sipDialTarget(process.env);
    const promise = (async (): Promise<RawWindow> => {
      const started = Date.now();
      const [callsTo, callsFrom, smsTo, smsFrom, sipLegs, recordings] =
        await Promise.all([
          this.signalwire.listCalls({ to: supportNumber, before }),
          this.signalwire.listCalls({ from: supportNumber, before }),
          this.signalwire.listMessages({ to: supportNumber, before }),
          this.signalwire.listMessages({ from: supportNumber, before }),
          // Account-wide: every browser shares one SIP credential, so this returns
          // other companies' child legs too. Only `parentCallSid` is read, and only
          // to match calls already established as this company's — no field of
          // another company's row is ever surfaced.
          sipTarget
            ? this.signalwire.listCalls({ to: `sip:${sipTarget}`, before })
            : Promise.resolve([] as SwCall[]),
          // Recordings carry no To/From filter — they belong to a call, not a number.
          // Same containment argument: only `callSid` is read. `before` bounds it to the
          // same window as the calls above; without it this is the newest page account-
          // wide, so past one page of recordings the OLDER rows in this window lose
          // their badge while the detail view still plays the audio.
          //
          // The failure is swallowed because a timeline without recording badges beats a
          // 500 — but it is LOGGED, not silent. Every row reporting "no recording" with
          // no explanation anywhere is indistinguishable from nothing ever being
          // recorded, which is a long way to chase from the other end.
          this.signalwire.listRecordings({ before }).catch((err) => {
            this.logger.warn(
              `recordings lookup failed for company ${companyId} — every row in this ` +
                `window will report no recording: ${err instanceof Error ? err.message : String(err)}`,
            );
            return [] as SwRecording[];
          }),
        ]);

      const rows: RawWindow = {
        calls: [...callsTo, ...callsFrom],
        sipLegs,
        messages: [...smsTo, ...smsFrom],
        // The rows as fetched. Mapping these down to a Set of call sids is what made
        // every missed call look like a voicemail — see `BuildInput.recordings`.
        recordings,
        // A full page means SignalWire had at least this many; there may be older
        // rows beyond the window.
        truncated: [callsTo, callsFrom, smsTo, smsFrom].some(
          (list) => list.length >= 200,
        ),
      };

      this.logger.log(
        `timeline company=${companyId} ${before ? 'page' : 'head'} ` +
          `calls=${rows.calls.length} sms=${rows.messages.length} ` +
          `sipLegs=${sipLegs.length} recordings=${rows.recordings.length} ` +
          `${Date.now() - started}ms`,
      );
      return rows;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    const rows = await promise;
    this.evictStale();
    this.cache.set(key, {
      at: Date.now(),
      // ⚠️ The live check comes FIRST, above the `before` branch and not only on HEAD: a
      // cursor page can hold a live leg too, and a 5-minute historic TTL over an
      // in-progress call is the same bug an order of magnitude worse.
      ttl: windowHasLiveLeg(rows.calls, rows.sipLegs)
        ? PhoneTimelineService.LIVE_TTL_MS
        : before
          ? PhoneTimelineService.HISTORIC_TTL_MS
          : PhoneTimelineService.TTL_MS,
      rows,
    });
    return rows;
  }

  private evictStale(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.at > entry.ttl) this.cache.delete(key);
    }
    // Still too big after expiry (many live companies): drop the oldest.
    while (this.cache.size >= PhoneTimelineService.MAX_ENTRIES) {
      const oldest = [...this.cache.entries()].sort(
        (a, b) => a[1].at - b[1].at,
      )[0];
      if (!oldest) break;
      this.cache.delete(oldest[0]);
    }
  }

  /**
   * This company's saved contacts as E.164 -> name.
   *
   * Never throws: an address book that will not load must cost a NAME, never the call
   * history it labels. The rows are tiny and this is not cached alongside `loadWindow`
   * deliberately — that cache holds raw SignalWire rows for 45s, and freezing names into
   * it would leave a contact renamed in one tab still showing the old label in another.
   *
   * Later rows win on a duplicate number, which matches the list order (`name` ascending)
   * so the choice is at least stable rather than arbitrary.
   */
  private async contactNamesFor(
    companyId: number,
  ): Promise<Map<string, string>> {
    try {
      const rows = await this.prisma.contact.findMany({
        where: { companyId, deletedAt: null, phoneE164: { not: null } },
        select: { phoneE164: true, name: true },
        orderBy: { name: 'asc' },
      });
      return new Map(rows.map((r) => [r.phoneE164!, r.name]));
    } catch (err) {
      this.logger.warn(
        `contactNamesFor(${companyId}) failed, rows will show numbers: ${String(err)}`,
      );
      return new Map();
    }
  }

  /**
   * Raw legs plus the read/completed overlay, as INBOX rows.
   *
   * ⚠️ `hideOwnSmsReplies` is applied HERE and nowhere else. This method feeds
   * `getTimeline`, `getCounts` and `getUnreadItems` — every surface that wants your own
   * replies gone. `getSmsThread` and `sendSms` call `buildPhoneItems` directly and must
   * keep both directions: a conversation showing only the customer's half, and a reply
   * that never appears after sending, is what happened when the rule lived in the builder.
   */
  private async itemsFor(
    companyId: number,
    supportNumber: string,
    before: number | undefined,
  ): Promise<{ items: PhoneItemDto[]; truncated: boolean }> {
    const [window, readIds, completedIds, contactNames] = await Promise.all([
      this.loadWindow(companyId, supportNumber, before),
      this.state.getReadSet(companyId),
      this.state.getCompletedSet(companyId),
      this.contactNamesFor(companyId),
    ]);
    return {
      items: hideOwnSmsReplies(
        buildPhoneItems({
          supportNumber,
          calls: window.calls,
          sipLegs: window.sipLegs,
          messages: window.messages,
          recordings: window.recordings,
          minRecordingSec: minRecordingSeconds(process.env),
          readIds,
          completedIds,
          contactNames,
        }),
      ),
      truncated: window.truncated,
    };
  }

  /**
   * A page of the merged feed, newest first.
   *
   * The cursor is a TIMESTAMP, not an offset: the client merges this stream with the
   * email and chat streams, which page independently, so only a time-ordered cursor
   * composes with them. It also survives a new call arriving between requests, which
   * an offset would not.
   */
  async getTimeline(
    companyId: number,
    beforeIso?: string,
    limit = 25,
  ): Promise<PhoneTimelineResult> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) {
      return {
        items: [],
        nextCursor: null,
        hasMore: false,
        hasNumber: false,
        supportNumber: null,
      };
    }

    const before = beforeIso ? new Date(beforeIso).getTime() : undefined;
    const beforeMs = Number.isFinite(before) ? before : undefined;

    // ── PAGE OUT OF THE HEAD WINDOW WHENEVER IT CAN ANSWER ────────────────────
    // The head window holds up to 200 rows per stream, which for a company this size
    // is its entire history — so scrolling the inbox is pure in-memory slicing of one
    // cached fetch. Giving every cursor its own window instead would cost five
    // SignalWire requests PER PAGE, and the UNCOMPLETED folder's auto-fill pages to
    // completion: a company with a hundred-odd open items would fire hundreds of
    // third-party requests just by opening a tab.
    let { items, truncated } = await this.itemsFor(
      companyId,
      supportNumber,
      undefined,
    );

    // Trim exactly. The API window is inclusive at its edge and a cursor points AT a
    // row we already served, so without this the boundary row repeats every page.
    const eligibleFrom = (rows: PhoneItemDto[]) =>
      beforeMs === undefined
        ? rows
        : rows.filter((i) => new Date(i.at).getTime() < beforeMs);

    let eligible = eligibleFrom(items);

    // Only when the head window is genuinely exhausted AND there is more behind it do
    // we pay for a deeper one.
    if (beforeMs !== undefined && eligible.length < limit && truncated) {
      const deeper = await this.itemsFor(companyId, supportNumber, beforeMs);
      items = deeper.items;
      truncated = deeper.truncated;
      eligible = eligibleFrom(items);
    }

    const page = eligible.slice(0, limit);
    // An empty page always ends the feed, whatever `truncated` says — otherwise a
    // window that yields nothing new would hand back the same cursor forever and the
    // client would page against it indefinitely.
    const hasMore = eligible.length > limit || (page.length > 0 && truncated);

    return {
      items: page,
      nextCursor: page.length > 0 ? page[page.length - 1].at : null,
      hasMore,
      hasNumber: true,
      supportNumber,
    };
  }

  /**
   * Unread and uncompleted phone items for the tab's folder badges.
   *
   * Served off the SAME cached window the feed just used, so with the tab open this
   * costs nothing. That is the reason it is here rather than going through
   * `MessageStateService.getUncompletedCount`: that cache is keyed on companyId alone
   * and is already occupied by the mailbox's count, so a second caller would race it
   * and both would read whichever landed first.
   *
   * ── WHY ONLY THE LAST 30 DAYS ──────────────────────────────────────────────
   * Every call a company ever received is "uncompleted" until somebody ticks it. On a
   * number that has been live for a year that is a badge in the hundreds on first
   * load, and the inbox's auto-fill would page towards a target the list can never
   * reach. A recent window is the number a person would actually act on.
   *
   * ── THE DASHBOARD'S CROSS-COMPANY BADGE ────────────────────────────────────
   * This used to be per-company and on demand only, because
   * `GET /communications/uncompleted-counts` answers for EVERY company at once on a
   * 60s poll and a phone sweep costs six SignalWire requests per company. But a
   * company with a support number and no mailbox got no key in that map at all, and
   * `CompanyRow` renders no badge for a missing key — so a backlog of calls and texts
   * was invisible from the dashboard, which is where people look first.
   *
   * `getUncompletedCountsForAll` below folds phone in, guarded by its own cache rather
   * than by leaving the data out. See the note there for why that cache is separate.
   */
  async getCounts(companyId: number): Promise<PhoneCountsDto> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) return { unread: 0, uncompleted: 0, missedUnread: 0 };

    const { items } = await this.itemsFor(companyId, supportNumber, undefined);
    const since = Date.now() - PhoneTimelineService.COUNT_WINDOW_MS;
    const recent = items.filter((i) => new Date(i.at).getTime() >= since);
    return {
      unread: recent.filter((i) => !i.isRead).length,
      uncompleted: recent.filter((i) => !i.isCompleted).length,
      // Same list, same window — so the Missed calls folder badge can never exceed the
      // Unread badge beside it.
      missedUnread: recent.filter(isUnreadMissedCall).length,
    };
  }

  /**
   * Unread calls and texts for the notification bell's feed.
   *
   * Reads the SAME cached window and applies the SAME 30-day `COUNT_WINDOW_MS` as
   * `getCounts`, so the bell and the tab's own badge can never disagree about what
   * counts as unread — one window, one rule, two readers.
   *
   * Deliberately NO cross-company cache here, unlike `getUncompletedCountsForAll`:
   * `UnreadFeedService` owns the per-company cache that guards this fan-out, and a
   * second single-slot cache in this service would just be a third caller racing the
   * window for no benefit.
   *
   * Outbound items are `isRead: true` by construction — you cannot have an unread call
   * you placed — so they can never appear here and need no filtering.
   */
  async getUnreadItems(
    companyId: number,
    limit: number,
  ): Promise<PhoneItemDto[]> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) return [];

    const { items } = await this.itemsFor(companyId, supportNumber, undefined);
    const since = Date.now() - PhoneTimelineService.COUNT_WINDOW_MS;
    return items
      .filter((i) => !i.isRead && new Date(i.at).getTime() >= since)
      .slice(0, limit);
  }

  /**
   * Uncompleted phone items for every company that has a live number, keyed by company
   * id — the phone half of the dashboard's cross-company badge.
   *
   * Enumerating `SupportNumber` rather than every company is not a filter: `getCounts`
   * short-circuits to zero the moment `activeNumber()` comes back null, so a company
   * without a number contributes nothing either way. This just avoids asking.
   *
   * A company whose sweep throws is OMITTED, not zeroed, matching
   * `GmailService.getUncompletedCounts` — absent means "unknown", and the client draws
   * no badge rather than a confident zero.
   *
   * ── WHY ITS OWN CACHE ──────────────────────────────────────────────────────
   * Not `MessageStateService.getUncompletedCount`: that cache is keyed on companyId
   * alone and is already occupied by the mailbox's count (see `getCounts`). And not
   * the window cache either — `TTL_MS` is 20s, below the dashboard's 60s poll, so
   * every poll would miss and pay the full six requests per company again. This TTL
   * sits just under the poll interval so one sweep serves every signed-in dashboard.
   *
   * A new call arriving is allowed to be a minute stale. A MARK is not: see
   * `refreshCompanyCounts`, which the read/completed routes await so the dashboard's
   * "missed calls" badge drops the moment somebody opens the call.
   *
   * ONE sweep fills both maps (uncompleted and unread-missed) — they come out of the
   * same `getCounts` call, and a second sweep would double the SignalWire traffic for
   * a number that was already sitting in memory.
   */
  private countsAll: { at: number; maps: PhoneCountsMapsDto } | null = null;
  private countsAllInFlight: Promise<PhoneCountsMapsDto> | null = null;
  private static readonly COUNTS_ALL_TTL_MS = 55_000;
  private static readonly COUNTS_ALL_CONCURRENCY = 4;

  async getUncompletedCountsForAll(): Promise<Record<number, number>> {
    return (await this.getCountsForAll()).uncompleted;
  }

  /**
   * Unread missed calls (voicemails included) per company, from the same sweep and
   * cache as `getUncompletedCountsForAll`, with the same absent-means-unknown rule.
   */
  async getMissedUnreadCountsForAll(): Promise<Record<number, number>> {
    return (await this.getCountsForAll()).missedUnread;
  }

  /**
   * Re-count ONE company into the cross-company cache after its read/completed state
   * changed.
   *
   * Without this the dashboard keeps serving the pre-mark sweep for up to 55s — and the
   * client refetches `inbox-summary` straight after a mark, so it would be handed the
   * OLD number and the badge would bounce back up after its optimistic decrement.
   *
   * Cheap: `itemsFor` re-applies read/completed state fresh over the 45s window cache,
   * which the open Communications tab keeps warm. Never throws — a mark that succeeded
   * must not report failure because a badge could not be recounted.
   */
  async refreshCompanyCounts(companyId: number): Promise<void> {
    if (!this.countsAll) return; // nothing cached yet; the next sweep is fresh anyway
    try {
      const counts = await this.getCounts(companyId);
      // Written into whichever cache is current NOW: a sweep may have replaced it while
      // we were counting, and this count (taken after the mark) is newer than any of it.
      const maps = this.countsAll?.maps;
      if (!maps) return;
      maps.uncompleted[companyId] = counts.uncompleted;
      maps.missedUnread[companyId] = counts.missedUnread;
    } catch (err) {
      this.logger.warn(
        `could not refresh phone counts for company ${companyId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async getCountsForAll(): Promise<PhoneCountsMapsDto> {
    const cached = this.countsAll;
    if (
      cached &&
      Date.now() - cached.at < PhoneTimelineService.COUNTS_ALL_TTL_MS
    ) {
      return cached.maps;
    }
    // Several dashboards polling at once must not each start a sweep.
    if (this.countsAllInFlight) return this.countsAllInFlight;

    const run = this.sweepCounts()
      .then((maps) => {
        this.countsAll = { at: Date.now(), maps };
        return maps;
      })
      .finally(() => {
        this.countsAllInFlight = null;
      });
    this.countsAllInFlight = run;
    return run;
  }

  private async sweepCounts(): Promise<PhoneCountsMapsDto> {
    const rows = await this.prisma.supportNumber.findMany({
      where: { releasedAt: null },
      select: { companyId: true },
    });
    // A company can in principle hold more than one live row; the badge is per company.
    const ids = [...new Set(rows.map((r) => r.companyId))];

    const out: PhoneCountsMapsDto = { uncompleted: {}, missedUnread: {} };
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const companyId = ids[next++];
        try {
          const counts = await this.getCounts(companyId);
          out.uncompleted[companyId] = counts.uncompleted;
          out.missedUnread[companyId] = counts.missedUnread;
        } catch (err) {
          // Omit, do not zero — see the doc comment above.
          this.logger.warn(
            `uncompleted phone count failed for company ${companyId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    };
    await Promise.all(
      Array.from(
        {
          length: Math.min(
            PhoneTimelineService.COUNTS_ALL_CONCURRENCY,
            ids.length,
          ),
        },
        worker,
      ),
    );
    return out;
  }

  /**
   * The whole SMS conversation with one number, oldest first.
   *
   * Both `To` and `From` are applied by SignalWire when given together (verified), so
   * this is two narrow queries rather than a scan.
   */
  async getSmsThread(
    companyId: number,
    peer: string,
    limit = 200,
  ): Promise<SmsThreadResult> {
    if (!isE164(peer)) {
      throw new BadRequestException('peer must be an E.164 number');
    }
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) {
      return { messages: [], peer, supportNumber: null };
    }

    const [inbound, outbound, readIds, completedIds, contactNames] =
      await Promise.all([
        this.signalwire.listMessages({ to: supportNumber, from: peer }),
        this.signalwire.listMessages({ to: peer, from: supportNumber }),
        this.state.getReadSet(companyId),
        this.state.getCompletedSet(companyId),
        this.contactNamesFor(companyId),
      ]);

    const messages = buildPhoneItems({
      supportNumber,
      calls: [],
      sipLegs: [],
      messages: [...inbound, ...outbound],
      recordings: [],
      readIds,
      completedIds,
      contactNames,
    })
      .filter((i): i is SmsItemDto => i.kind === 'sms')
      // Oldest first: a conversation reads downward, unlike the inbox.
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(-limit);

    return {
      messages: await this.withMedia(messages),
      peer,
      supportNumber,
    };
  }

  /**
   * Attach each MMS's file list to the messages of one thread.
   *
   * ⚠️ THREAD ONLY. The inbox list polls every 15s across every conversation a company has
   * ever had, and this costs one provider request per message with media — a conversation
   * with ten photos in it would add ten requests to every poll, forever. A thread is opened
   * deliberately, holds one conversation, and pays once per refresh.
   *
   * Bounded concurrency through the same `pool` the mailboxes use, and a failure on one
   * message costs that message's attachments, never the thread: a text that renders without
   * its picture is a degraded row, while a 500 here is a conversation nobody can read.
   *
   * The tokens are minted here because THIS is where ownership was proven — the messages
   * came from a query scoped to the company's own support number. The stream route only has
   * to verify the binding.
   */
  private async withMedia(messages: SmsItemDto[]): Promise<SmsItemDto[]> {
    const withAny = messages.filter((m) => m.numMedia > 0);
    if (withAny.length === 0) return messages;

    const lists = await pool(
      withAny,
      PhoneTimelineService.SMS_MEDIA_CONCURRENCY,
      async (m) => {
        try {
          return await this.signalwire.listMessageMedia(m.sid);
        } catch (err) {
          this.logger.warn(
            `media list for message ${m.sid} failed: ${String(err)}`,
          );
          return [];
        }
      },
    );

    const byId = new Map(
      withAny.map((m, i) => [
        m.id,
        lists[i].map((file) => ({
          sid: file.sid,
          contentType: file.contentType,
          token: signSmsMediaToken(m.sid, file.sid),
        })),
      ]),
    );
    return messages.map((m) =>
      byId.has(m.id) ? { ...m, media: byId.get(m.id) } : m,
    );
  }

  /**
   * Send a text from the company's own number, with or without attachments.
   *
   * `files` are already on disk (multer staged them) and are DELETED by the caller in a
   * `finally` — the staging directory is transit, never storage.
   */
  async sendSms(
    companyId: number,
    to: string,
    body: string,
    files: StagedMms[] = [],
  ): Promise<SmsItemDto> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) {
      throw new NotFoundException('This company has no support number');
    }
    if (!isE164(to)) {
      throw new BadRequestException('to must be an E.164 number');
    }
    if (to === supportNumber) {
      throw new BadRequestException('Cannot text the company’s own number');
    }
    // The do-not-text list, checked BEFORE the send rather than left to the carrier.
    // A US carrier does block a number that messages someone who sent STOP, so leaving
    // this out does not reach the customer — it just books an opt-out violation against
    // the campaign on every attempt, invisibly, until the campaign is suspended.
    // Failing here instead puts it in front of the person about to press send.
    if (await this.optOuts.isOptedOut(to)) {
      throw new BadRequestException(
        'This number has opted out of text messages (replied STOP). They must text ' +
          'START to opt back in before we can message them again.',
      );
    }
    const text = body.trim();
    // An MMS with a picture and no words is an ordinary thing to send, so the body is only
    // required when there is nothing else in the message.
    if (!text && files.length === 0) {
      throw new BadRequestException('Message body is required');
    }
    if (text.length > 1600) {
      throw new BadRequestException('Message is longer than 10 SMS segments');
    }

    // Shrink first, then publish: the URLs have to name the files SignalWire will actually
    // fetch, and shrinking replaces them.
    const mediaUrls = files.length > 0 ? await this.publishMms(files) : [];

    // `from` is derived here, never taken from the client: it is the company's
    // identity and it is what gets billed.
    const sent = await this.signalwire.sendSms({
      to,
      from: supportNumber,
      body: text,
      mediaUrls,
    });
    this.bust(companyId);

    const [item] = buildPhoneItems({
      supportNumber,
      calls: [],
      sipLegs: [],
      messages: [sent],
      recordings: [],
      readIds: new Set(),
      completedIds: new Set(),
      // The client drops straight into the conversation after sending, so this one row
      // sits beside rows built by getSmsThread. Without the map it would be the only
      // message in the thread showing a bare number.
      contactNames: await this.contactNamesFor(companyId),
    });
    return item as SmsItemDto;
  }

  /**
   * Re-encode each attachment to fit a text message, and hand back the URLs SignalWire
   * should fetch them from.
   *
   * ── WHY THIS SHRINKS RATHER THAN REFUSING ──────────────────────────────────────
   * The files come from a phone camera, so they are 3-8 MB as a matter of course. A large
   * share of North American carriers silently DROP an MMS much over a megabyte — the
   * message reports `sent`, is billed, and simply never arrives. Refusing them would make
   * the feature unusable; sending them unchanged would make it unreliable in the one way
   * nobody can debug. So an image walks down `MMS_IMAGE_LADDER` until it fits and audio is
   * re-encoded to telephone-grade mono, and only a file that still will not fit is refused
   * — with a message saying so, while the person can still do something about it.
   *
   * A file that is neither image nor audio (a PDF, a vCard) is passed through if it already
   * fits and refused if it does not: there is no lossy re-encode for it, and quietly
   * dropping it would be the silent failure again.
   */
  private async publishMms(files: StagedMms[]): Promise<string[]> {
    if (files.length > MAX_MMS_FILES) {
      throw new BadRequestException(
        `A text message can carry at most ${MAX_MMS_FILES} attachments`,
      );
    }
    // Throws when neither PUBLIC_BASE_URL nor CALLBACK_BASE_URL is set, rather than
    // handing SignalWire a localhost URL that fails at the carrier minutes later with
    // nothing in the error naming the cause.
    const base = requirePublicBase(process.env);
    const budget = perFileBudget(MAX_MMS_TOTAL_BYTES, files.length);

    const urls: string[] = [];
    for (const file of files) {
      const fitted = await this.fitForMms(file, budget);
      urls.push(
        `${base}/api/phone/mms/${encodeURIComponent(fitted)}?token=${encodeURIComponent(signMmsToken(fitted))}`,
      );
    }
    return urls;
  }

  /**
   * Get one staged file under `budget` bytes, returning the staged NAME to serve.
   *
   * Writes any re-encoded result beside the original and hands back the new name; the
   * caller's `finally` deletes the whole staging directory's worth either way, because
   * `discardStagedMms` is given every path this produced.
   */
  private async fitForMms(file: StagedMms, budget: number): Promise<string> {
    // Checked again here, not only in multer's fileFilter. The filter is the early,
    // readable rejection; this is the guard, and it runs whatever calls the service.
    if (!isMmsImage(file.mimetype, file.filename)) {
      throw new BadRequestException(
        'A text message can only carry pictures — PNG, JPEG, GIF or WebP.',
      );
    }

    const source = await readFile(file.path);
    if (source.length <= budget) return file.filename;

    for (const rung of MMS_IMAGE_LADDER) {
      try {
        const out = await sharp(source, { failOn: 'none' })
          .rotate() // honour EXIF orientation before the metadata is dropped
          .resize(rung.edge, rung.edge, {
            fit: 'inside',
            withoutEnlargement: true,
          })
          .jpeg({ quality: rung.quality })
          .toBuffer();
        if (out.length <= budget) {
          // ⚠️ An over-budget ANIMATED GIF comes back a still JPEG. Said out loud rather
          // than left to be discovered: the alternative is refusing it, and a still frame
          // that arrives beats an animation that does not.
          return await this.writeStagedMms(out, '.jpg', file);
        }
      } catch (err) {
        this.logger.warn(`mms image re-encode failed: ${String(err)}`);
        break;
      }
    }
    throw new BadRequestException(
      'That picture is too large to send as a text message, even after shrinking. Try a smaller one.',
    );
  }

  /** Write a re-encoded attachment beside its original and record it for cleanup. */
  private async writeStagedMms(
    bytes: Buffer,
    ext: string,
    origin: StagedMms,
  ): Promise<string> {
    ensureMmsDir();
    const filename = `${randomUUID()}${ext}`;
    await writeFile(path.join(MMS_DIR, filename), bytes);
    // So the caller's `finally` removes the derived file too, not only what multer wrote.
    origin.derived.push(path.join(MMS_DIR, filename));
    return filename;
  }

  /**
   * Every recording belonging to a call, looking on this leg and then on its parent.
   *
   * Click-to-call runs its `<Dial>` on the parent (the SIP leg to the browser), so an
   * outbound call's audio is filed against a sid that never appears in the feed —
   * asking only for `callSid` finds nothing, and the detail view claims there is no
   * recording while the audio sits on SignalWire. That cost a release once already.
   *
   * NO ownership check: this is the raw lookup, shared with the summary worker, which
   * runs server-side against calls that may have no company at all (internal staff
   * calls). Every REQUEST path must go through `getCallRecordings` instead.
   *
   * Returns the parent sid it fell back to, because the caller usually needs to know
   * which leg the audio was actually filed against.
   *
   * Deliberately UNFILTERED: the sub-threshold gate that hides a hang-up at the beep lives
   * in `getCallRecordings`, because the summary worker wants the longest recording it can
   * find (it has its own empty-transcript skip) and `internal-calls` has no voicemail path
   * at all.
   */
  async findRecordingsForCall(
    callSid: string,
    knownCall?: SwCall | null,
  ): Promise<{ recordings: SwRecording[]; onSid: string }> {
    const own = await this.signalwire.listRecordings({ callSid });
    if (own.length > 0) return { recordings: own, onSid: callSid };

    const call = knownCall ?? (await this.signalwire.getCall(callSid));
    if (!call?.parentCallSid) return { recordings: [], onSid: callSid };

    const parent = await this.signalwire.listRecordings({
      callSid: call.parentCallSid,
    });
    return { recordings: parent, onSid: call.parentCallSid };
  }

  /** Recordings for one call, after checking the call is this company's. */
  async getCallRecordings(
    companyId: number,
    callSid: string,
  ): Promise<RecordingDto[]> {
    const call = await this.assertCallBelongsTo(companyId, callSid);
    const { recordings } = await this.findRecordingsForCall(callSid, call);

    // The SAME predicate the list uses. Not a tidy-up: the row saying "Missed call" while
    // this view offers a player is the list/detail disagreement this module has already
    // paid for once, and a sub-threshold clip here is a hang-up at the beep, not audio.
    const minSec = minRecordingSeconds(process.env);
    const audible = recordings.filter((r) => isAudibleRecording(r, minSec));
    if (audible.length < recordings.length) {
      this.logger.log(
        `call ${callSid}: ${recordings.length - audible.length} recording(s) under ` +
          `${minSec}s hidden (hang-up at the beep, most likely)`,
      );
    }

    // The ownership check above is what this token attests to, so it is minted here
    // and nowhere else.
    return audible.map((r) => ({
      sid: r.sid,
      durationSec: r.durationSec,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
      token: signRecordingToken(r.sid),
    }));
  }

  /**
   * Throws unless `callSid` is a call on this company's support number.
   *
   * Without it, any authenticated user could read any company's recordings by SID.
   * The check is against the number rather than a stored row because we store no
   * calls — the leg itself is the evidence.
   */
  async assertCallBelongsTo(
    companyId: number,
    callSid: string,
  ): Promise<SwCall> {
    return (await this.assertCallBelongsToNumber(companyId, callSid)).call;
  }

  /**
   * As above, and also hands back the number it checked against.
   *
   * A thin widening rather than a change to `assertCallBelongsTo`: four callers want only
   * the leg, and every one of them is an ownership check on a path where getting the
   * signature wrong is a privilege question. The support number is already in hand here —
   * re-fetching it in the one caller that needs it would be a second DB read and a second
   * chance for the two to disagree about which number "this company's" means.
   */
  async assertCallBelongsToNumber(
    companyId: number,
    callSid: string,
  ): Promise<{ call: SwCall; supportNumber: string }> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) {
      throw new NotFoundException('This company has no support number');
    }
    const call = await this.signalwire.getCall(callSid);
    // Same 404 for "no such call" and "not yours": the SID is not a secret, but which
    // company a call belongs to is, and distinguishing the two would leak it.
    if (!call) throw new NotFoundException('Call not found');
    // Compared through `legNumber`, not by raw equality: a SIP leg reports its number
    // wrapped, as `sip:+14382561210@sip.signalwire.com`. Raw equality rejects exactly
    // the parent leg that holds an outbound call's recording.
    if (
      legNumber(call.to) !== supportNumber &&
      legNumber(call.from) !== supportNumber
    ) {
      this.logger.warn(
        `company ${companyId} asked for call ${callSid}, which is not on its number`,
      );
      throw new NotFoundException('Call not found');
    }
    return { call, supportNumber };
  }

  /**
   * The inbox row for a call the agent is on — the id its "End & complete" writes against.
   *
   * ── WHY THIS IS NOT `swcall:{the sid the browser holds}` ───────────────────────
   * For an inbound call it is, and `rowItemIdFor` says so in one hop with no extra
   * request. For click-to-call it is NOT: the browser holds the `outbound-api` SIP root,
   * which the timeline drops as a duplicate, and the rendered row is its `outbound-dial`
   * child. Marking the root would write a state row nothing ever reads back — the call
   * would simply never show as completed, with no error anywhere.
   *
   * The child is found two ways, cheapest first. `ParentCallSid` is one request and is
   * right whenever the sid we hold is the live root. When it is not — a click-to-call to a
   * SIP credential registered in two browsers is FORKED into one root per registration and
   * the API returns only one sid, "often the twin nobody answered" — that query finds
   * nothing, so the fallback searches the window around the call for the `outbound-dial`
   * leg on this company's number. Exactly one match wins; several is ambiguous and throws
   * rather than completing somebody else's call.
   */
  async rowItemIdForCall(
    call: SwCall,
    supportNumber: string,
  ): Promise<string | null> {
    const own = rowItemIdFor(call, supportNumber);
    if (own) return own;

    const children = await this.signalwire.listCalls({
      parentCallSid: call.sid,
    });
    const child = pickConnectedChild(
      children.filter(
        (c) =>
          c.parentCallSid === call.sid &&
          rowItemIdFor(c, supportNumber) !== null,
      ),
    );
    if (child) return callItemId(child.sid);

    // The forked-twin case. A ±15s window around the root, because the child is created
    // when the <Dial> runs and SignalWire timestamps have one-second precision.
    const rows = await this.signalwire.listCalls({
      from: supportNumber,
      after: call.startedAt - 15_000,
      before: call.startedAt + 15_000,
    });
    const candidates = rows.filter(
      (c) =>
        c.direction === 'outbound-dial' &&
        rowItemIdFor(c, supportNumber) !== null,
    );
    // Ambiguity is a caller error, not a coin flip: two outbound calls in the same 30s
    // window on one line means completing the wrong customer's row.
    if (candidates.length !== 1) {
      this.logger.warn(
        `call ${call.sid}: ${candidates.length} candidate rows in window, cannot identify one`,
      );
      return null;
    }
    return callItemId(candidates[0].sid);
  }
}

interface RawWindow {
  calls: SwCall[];
  sipLegs: SwCall[];
  messages: SwMessage[];
  recordings: SwRecording[];
  truncated: boolean;
}
