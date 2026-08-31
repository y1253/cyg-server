import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { MessageStateService } from '../communications/message-state.service.js';
import { SignalWireService } from './signalwire.service.js';
import { sipDialTarget } from './phone.config.js';
import { isE164, type SwCall, type SwMessage } from './signalwire-parse.js';
import { buildPhoneItems } from './phone-timeline.util.js';
import { signRecordingToken } from './recording-token.util.js';
import type {
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
  ) {}

  /**
   * How long a fetched window is reused.
   *
   * The inbox polls every 15s per open company, so without this each poll would cost
   * five SignalWire round-trips. Slightly above the poll interval so consecutive polls
   * hit the cache, and short enough that a new call surfaces quickly on its own. The
   * webhooks and our own send paths call `bust()`, so inbound SMS and finished calls
   * do not wait for it.
   */
  private static readonly TTL_MS = 20_000;
  /** An older window cannot change, so it is held far longer. */
  private static readonly HISTORIC_TTL_MS = 5 * 60_000;
  /** Bounds the cache: companies × cursors would otherwise grow without limit. */
  private static readonly MAX_ENTRIES = 300;
  /** How far back the folder badges count. See `getCounts`. */
  private static readonly COUNT_WINDOW_MS = 30 * 24 * 60 * 60_000;

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
          // Same containment argument: only `callSid` is read.
          this.signalwire
            .listRecordings()
            .catch(() => [] as { sid: string; callSid: string | null }[]),
        ]);

      const rows: RawWindow = {
        calls: [...callsTo, ...callsFrom],
        sipLegs,
        messages: [...smsTo, ...smsFrom],
        recordedCallSids: new Set(
          recordings
            .map((r) => r.callSid)
            .filter((s): s is string => typeof s === 'string'),
        ),
        // A full page means SignalWire had at least this many; there may be older
        // rows beyond the window.
        truncated: [callsTo, callsFrom, smsTo, smsFrom].some(
          (list) => list.length >= 200,
        ),
      };

      this.logger.log(
        `timeline company=${companyId} ${before ? 'page' : 'head'} ` +
          `calls=${rows.calls.length} sms=${rows.messages.length} ` +
          `sipLegs=${sipLegs.length} ${Date.now() - started}ms`,
      );
      return rows;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, promise);
    const rows = await promise;
    this.evictStale();
    this.cache.set(key, {
      at: Date.now(),
      ttl: before
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

  /** Raw legs plus the read/completed overlay, as inbox rows. */
  private async itemsFor(
    companyId: number,
    supportNumber: string,
    before: number | undefined,
  ): Promise<{ items: PhoneItemDto[]; truncated: boolean }> {
    const [window, readIds, completedIds] = await Promise.all([
      this.loadWindow(companyId, supportNumber, before),
      this.state.getReadSet(companyId),
      this.state.getCompletedSet(companyId),
    ]);
    return {
      items: buildPhoneItems({
        supportNumber,
        calls: window.calls,
        sipLegs: window.sipLegs,
        messages: window.messages,
        recordedCallSids: window.recordedCallSids,
        readIds,
        completedIds,
      }),
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
   * ── WHY THIS IS NOT IN THE DASHBOARD'S CROSS-COMPANY BADGE ─────────────────
   * `GET /communications/uncompleted-counts` answers for EVERY company at once, on a
   * 60s poll. A phone count costs five SignalWire requests per company, so folding it
   * in would mean hundreds of third-party requests a minute for a number nobody is
   * looking at. The phone contribution is deliberately per-company and on demand.
   */
  async getCounts(
    companyId: number,
  ): Promise<{ unread: number; uncompleted: number }> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) return { unread: 0, uncompleted: 0 };

    const { items } = await this.itemsFor(companyId, supportNumber, undefined);
    const since = Date.now() - PhoneTimelineService.COUNT_WINDOW_MS;
    const recent = items.filter((i) => new Date(i.at).getTime() >= since);
    return {
      unread: recent.filter((i) => !i.isRead).length,
      uncompleted: recent.filter((i) => !i.isCompleted).length,
    };
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

    const [inbound, outbound, readIds, completedIds] = await Promise.all([
      this.signalwire.listMessages({ to: supportNumber, from: peer }),
      this.signalwire.listMessages({ to: peer, from: supportNumber }),
      this.state.getReadSet(companyId),
      this.state.getCompletedSet(companyId),
    ]);

    const messages = buildPhoneItems({
      supportNumber,
      calls: [],
      sipLegs: [],
      messages: [...inbound, ...outbound],
      recordedCallSids: new Set(),
      readIds,
      completedIds,
    })
      .filter((i): i is SmsItemDto => i.kind === 'sms')
      // Oldest first: a conversation reads downward, unlike the inbox.
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(-limit);

    return { messages, peer, supportNumber };
  }

  /** Send an SMS from the company's own number. */
  async sendSms(
    companyId: number,
    to: string,
    body: string,
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
    const text = body.trim();
    if (!text) throw new BadRequestException('Message body is required');
    if (text.length > 1600) {
      throw new BadRequestException('Message is longer than 10 SMS segments');
    }

    // `from` is derived here, never taken from the client: it is the company's
    // identity and it is what gets billed.
    const sent = await this.signalwire.sendSms({
      to,
      from: supportNumber,
      body: text,
    });
    this.bust(companyId);

    const [item] = buildPhoneItems({
      supportNumber,
      calls: [],
      sipLegs: [],
      messages: [sent],
      recordedCallSids: new Set(),
      readIds: new Set(),
      completedIds: new Set(),
    });
    return item as SmsItemDto;
  }

  /** Recordings for one call, after checking the call is this company's. */
  async getCallRecordings(
    companyId: number,
    callSid: string,
  ): Promise<RecordingDto[]> {
    await this.assertCallBelongsTo(companyId, callSid);
    const recordings = await this.signalwire.listRecordings({ callSid });
    // The ownership check above is what this token attests to, so it is minted here
    // and nowhere else.
    return recordings.map((r) => ({
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
  private async assertCallBelongsTo(
    companyId: number,
    callSid: string,
  ): Promise<void> {
    const supportNumber = await this.activeNumber(companyId);
    if (!supportNumber) {
      throw new NotFoundException('This company has no support number');
    }
    const call = await this.signalwire.getCall(callSid);
    // Same 404 for "no such call" and "not yours": the SID is not a secret, but which
    // company a call belongs to is, and distinguishing the two would leak it.
    if (!call) throw new NotFoundException('Call not found');
    if (call.to !== supportNumber && call.from !== supportNumber) {
      this.logger.warn(
        `company ${companyId} asked for call ${callSid}, which is not on its number`,
      );
      throw new NotFoundException('Call not found');
    }
  }
}

interface RawWindow {
  calls: SwCall[];
  sipLegs: SwCall[];
  messages: SwMessage[];
  recordedCallSids: Set<string>;
  truncated: boolean;
}
