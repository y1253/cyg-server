import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseAvailableNumbers,
  parseCalls,
  parseMessages,
  parseOwnedNumbers,
  parsePurchasedNumber,
  parseRecordings,
  signalwireErrorMessage,
  type AvailableNumber,
  type IsoCountry,
  type PurchasedNumber,
  type SignalWireJson,
  type SwCall,
  type SwMessage,
  type SwRecording,
} from './signalwire-parse.js';

/**
 * Per-call ceilings. `purchaseNumber` gets the loosest one deliberately: it is the only
 * call that spends money, so aborting a slow-but-working request is the worst outcome —
 * we would be billed for a number whose SID we never received.
 */
const TIMEOUTS = {
  searchAvailable: 12_000,
  purchaseNumber: 20_000,
  releaseNumber: 10_000,
  listOwned: 12_000,
  listCalls: 15_000,
  listMessages: 15_000,
  listRecordings: 12_000,
  fetchRecording: 30_000,
  sendSms: 15_000,
  createCall: 15_000,
  updateRecording: 10_000,
} as const;

/**
 * Rows per list request.
 *
 * 200 is honoured (verified: 195 rows came back in one page with a null
 * `next_page_uri`), and the whole account's call history is smaller than this. It is
 * deliberately well under the documented 1000 ceiling — the timeline issues several
 * of these in parallel per company, so the ceiling is response size, not row count.
 */
const DEFAULT_PAGE_SIZE = 200;

/**
 * Epoch ms as a full ISO timestamp, or undefined when absent.
 *
 * FULL ISO, never a date. SignalWire honours the time component and reads a bare
 * `YYYY-MM-DD` as midnight, so truncating a cursor to its date part silently drops
 * every row from the cursor's own day.
 */
function isoOrUndefined(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

export interface PurchaseInput {
  /** E.164. */
  phoneNumber: string;
  friendlyName?: string;
  voiceUrl?: string;
  smsUrl?: string;
  statusCallback?: string;
}

export interface SearchOptions {
  areaCode?: string;
  /** Province / state, e.g. 'QC'. This — not the country — is what actually filters. */
  inRegion?: string;
  inLocality?: string;
}

/**
 * The only place SignalWire credentials are read and the only place its HTTP surface is
 * touched. Knows nothing about companies; `PhoneProvisioningService` owns that.
 *
 * Modelled on `LuxandService.call()` so timing, timeouts and error mapping cannot drift
 * apart between methods. Two deliberate departures from that template:
 *
 *  1. There is no failure-envelope check. Luxand reports failures as HTTP 200 with a
 *     `{status:'failure'}` body; SignalWire uses real status codes, so `!res.ok` IS the
 *     error check here. Copying the envelope logic across would be cargo-culting.
 *
 *  2. DELETE answers 204 with an empty body, and `JSON.parse('')` throws. That case is
 *     handled explicitly rather than relying on the parse landing in a catch, so a later
 *     "if (!data) throw" guard cannot silently break releasing a number.
 */
@Injectable()
export class SignalWireService {
  private readonly logger = new Logger(SignalWireService.name);
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly timeoutOverride: number | null;

  constructor(config: ConfigService) {
    // The env var holds a BARE host (cygfinance.signalwire.com). Strip a protocol if
    // one is ever pasted in, rather than building https://https://… and failing only
    // at the first real call.
    const space = config
      .getOrThrow<string>('SIGNALWIRE_SPACE_URL')
      .replace(/^https?:\/\//, '')
      .replace(/\/+$/, '');
    const projectId = config.getOrThrow<string>('SIGNALWIRE_PROJECT_ID');
    const apiToken = config.getOrThrow<string>('SIGNALWIRE_API_TOKEN');

    this.baseUrl = `https://${space}/api/laml/2010-04-01/Accounts/${projectId}`;
    this.authHeader =
      'Basic ' + Buffer.from(`${projectId}:${apiToken}`).toString('base64');

    const timeout = config.get<string>('SIGNALWIRE_TIMEOUT_MS');
    this.timeoutOverride = timeout ? parseInt(timeout, 10) : null;
  }

  // ── HTTP ────────────────────────────────────────────────────────────────────

  private async call(
    label: string,
    path: string,
    init: {
      method: 'GET' | 'POST' | 'DELETE';
      query?: Record<string, string | undefined>;
      form?: Record<string, string | undefined>;
      timeoutMs: number;
    },
  ): Promise<SignalWireJson> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined && value !== '') url.searchParams.set(key, value);
    }

    // The Compatibility API is Twilio-shaped: request bodies are form-encoded, NOT
    // JSON. Responses come back as JSON regardless.
    let body: string | undefined;
    if (init.form) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(init.form)) {
        if (value !== undefined && value !== '') params.set(key, value);
      }
      body = params.toString();
    }

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: this.authHeader,
          Accept: 'application/json',
          ...(body
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        ...(body ? { body } : {}),
        signal: AbortSignal.timeout(this.timeoutOverride ?? init.timeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      this.logger.error(`${label} FAILED ${name} ${Date.now() - started}ms`);
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new BadGatewayException('Phone service timed out');
      }
      throw new BadGatewayException('Phone service unreachable');
    }

    const raw = await res.text();
    this.logger.log(`${label} ${res.status} ${Date.now() - started}ms`);

    // A 204 (or any empty body) is a success with nothing to parse — releaseNumber's
    // normal response. Handled before the parse so it can never look like a failure.
    if (res.status === 204 || raw === '') {
      if (!res.ok) {
        throw new BadGatewayException(
          `Phone service error (${res.status}): empty response body`,
        );
      }
      return null;
    }

    let data: SignalWireJson = null;
    try {
      data = JSON.parse(raw) as SignalWireJson;
    } catch {
      // Leave data null — a non-JSON body is itself a failure, reported raw below.
    }

    if (!res.ok) {
      const message = signalwireErrorMessage(data, raw);
      this.logger.warn(`${label} rejected: ${message.slice(0, 300)}`);
      throw new BadGatewayException(`Phone service error: ${message}`);
    }

    return data;
  }

  // ── Numbers ─────────────────────────────────────────────────────────────────

  /**
   * Searches purchasable local numbers.
   *
   * `country` sits in the path because the endpoint's shape requires it, but be aware
   * it is IGNORED by SignalWire — verified against the live API, where `/XX/Local` and
   * `/GB/Local` return the same New Jersey numbers as `/CA/Local`. Geography comes
   * from `inRegion` (province / state) or `areaCode`. Callers that care about where the
   * number is MUST pass one of those; see PhoneProvisioningService.
   */
  async searchAvailable(
    country: IsoCountry,
    opts: SearchOptions = {},
  ): Promise<AvailableNumber[]> {
    const data = await this.call(
      `searchAvailable ${country}${opts.inRegion ? '/' + opts.inRegion : ''}${
        opts.areaCode ? '/' + opts.areaCode : ''
      }`,
      `/AvailablePhoneNumbers/${country}/Local`,
      {
        method: 'GET',
        query: {
          AreaCode: opts.areaCode,
          InRegion: opts.inRegion,
          InLocality: opts.inLocality,
        },
        timeoutMs: TIMEOUTS.searchAvailable,
      },
    );
    return parseAvailableNumbers(data);
  }

  /**
   * Buys a number AND points its webhooks at us in a single request.
   *
   * The single call is a correctness property, not a micro-optimisation: a buy-then-
   * configure pair leaves a window where we own a live number that routes nowhere.
   * Do not split this.
   */
  async purchaseNumber(input: PurchaseInput): Promise<PurchasedNumber> {
    const data = await this.call(
      `purchaseNumber ${input.phoneNumber}`,
      '/IncomingPhoneNumbers',
      {
        method: 'POST',
        form: {
          PhoneNumber: input.phoneNumber,
          FriendlyName: input.friendlyName,
          VoiceUrl: input.voiceUrl,
          VoiceMethod: input.voiceUrl ? 'POST' : undefined,
          SmsUrl: input.smsUrl,
          SmsMethod: input.smsUrl ? 'POST' : undefined,
          StatusCallback: input.statusCallback,
        },
        timeoutMs: TIMEOUTS.purchaseNumber,
      },
    );

    const purchased = parsePurchasedNumber(data);
    if (!purchased) {
      // We may well have been billed. Say so loudly and name the number, because the
      // SID — the only handle for releasing it — is exactly what we failed to read.
      this.logger.error(
        `PHONE ORPHAN RISK — purchase of ${input.phoneNumber} returned an unreadable body; ` +
          `check the SignalWire dashboard for a number with no matching SupportNumber row`,
      );
      throw new BadGatewayException(
        'Phone service returned an unreadable purchase response',
      );
    }

    // The one record of what this endpoint actually returns for `capabilities`. The
    // probe cannot capture it (it never purchases), and the flags gate whether we keep
    // a number we have just been billed for, so a buy that goes wrong must be
    // attributable from the log alone. This path runs a handful of times a month.
    this.logger.log(
      `purchaseNumber ${purchased.phoneNumber} sid=${purchased.sid} ` +
        `capabilities=${purchased.capabilitiesRaw ?? 'ABSENT'}`,
    );
    return purchased;
  }

  /** Releases a number. Billing stops here. Returns normally on 404 — see below. */
  async releaseNumber(sid: string): Promise<void> {
    try {
      await this.call(`releaseNumber ${sid}`, `/IncomingPhoneNumbers/${sid}`, {
        method: 'DELETE',
        timeoutMs: TIMEOUTS.releaseNumber,
      });
    } catch (err) {
      // Already gone on their side is the outcome we wanted. Treating it as an error
      // would strand the row as permanently "active" with no number behind it, and no
      // way for a retry to ever clear it.
      const message = err instanceof Error ? err.message : String(err);
      if (/\b404\b|not found/i.test(message)) {
        this.logger.warn(
          `releaseNumber ${sid} already absent — treating as released`,
        );
        return;
      }
      throw err;
    }
  }

  /** Every number the project owns. Used by the orphan audit, not by request paths. */
  async listOwned(pageSize = 50): Promise<PurchasedNumber[]> {
    const data = await this.call('listOwned', '/IncomingPhoneNumbers', {
      method: 'GET',
      query: { PageSize: String(pageSize) },
      timeoutMs: TIMEOUTS.listOwned,
    });
    return parseOwnedNumbers(data);
  }

  // ── Calls, messages and recordings ──────────────────────────────────────────
  //
  // Everything here reads the Compatibility API's list endpoints. Two properties of
  // that API shape the signatures, both verified live rather than read from the docs
  // (scripts/signalwire-calls-probe.mjs):
  //
  //  1. THE DATE FILTERS HONOUR THE TIME, and a bare `YYYY-MM-DD` means MIDNIGHT.
  //     `StartTime<2026-08-27` returned 0 rows where `StartTime<2026-08-27T23:59:59Z`
  //     returned 145. The docs describe these params as dates, so truncating a cursor
  //     to its date part is the natural mistake — and it silently discards the whole
  //     cursor day on every page. These methods take epoch ms and send full ISO.
  //
  //  2. `next_page_uri` IS NOT FOLLOWABLE from here. It is a path rooted at
  //     `/api/laml/…`, while `this.baseUrl` already ends in `/Accounts/{projectId}`,
  //     so concatenating produces a doubled path that 404s. Nothing follows it: the
  //     timeline pages on a timestamp cursor and asks for one large page per window.
  //     `PageSize=200` is honoured (195 rows returned in a single page).

  /**
   * Call legs in a time window, optionally narrowed to one leg endpoint.
   *
   * `to` and `from` are ANDed by SignalWire when both are given, and there is no
   * "to OR from" form — which is why a company timeline costs several of these.
   * `to` also accepts a SIP URI, which is how the child legs of a `<Dial>` are
   * fetched; that is the only way to tell an unanswered inbound call from an
   * answered one, because the parent leg reports `completed` either way.
   */
  async listCalls(opts: {
    to?: string;
    from?: string;
    /** Epoch ms, exclusive-ish lower bound (SignalWire compares >=). */
    after?: number;
    /** Epoch ms upper bound. */
    before?: number;
    pageSize?: number;
  }): Promise<SwCall[]> {
    const data = await this.call(
      `listCalls${opts.to ? ' to=' + opts.to : ''}${opts.from ? ' from=' + opts.from : ''}`,
      '/Calls',
      {
        method: 'GET',
        query: {
          To: opts.to,
          From: opts.from,
          // The param names really do contain the comparator character.
          // URLSearchParams percent-encodes it in the key, which SignalWire accepts.
          'StartTime>': isoOrUndefined(opts.after),
          'StartTime<': isoOrUndefined(opts.before),
          PageSize: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
        },
        timeoutMs: TIMEOUTS.listCalls,
      },
    );
    return parseCalls(data);
  }

  /** SMS/MMS in a time window. `to` and `from` are ANDed when both are given. */
  async listMessages(opts: {
    to?: string;
    from?: string;
    after?: number;
    before?: number;
    pageSize?: number;
  }): Promise<SwMessage[]> {
    const data = await this.call(
      `listMessages${opts.to ? ' to=' + opts.to : ''}${opts.from ? ' from=' + opts.from : ''}`,
      '/Messages',
      {
        method: 'GET',
        query: {
          To: opts.to,
          From: opts.from,
          'DateSent>': isoOrUndefined(opts.after),
          'DateSent<': isoOrUndefined(opts.before),
          PageSize: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
        },
        timeoutMs: TIMEOUTS.listMessages,
      },
    );
    return parseMessages(data);
  }

  /**
   * One call leg by SID, or null when SignalWire does not know it.
   *
   * Used for the recording ownership check, which must not be answered by scanning
   * the account's whole call list: that is both slow and quietly wrong once the list
   * exceeds one page.
   */
  async getCall(sid: string): Promise<SwCall | null> {
    let data: SignalWireJson;
    try {
      data = await this.call(
        `getCall ${sid}`,
        `/Calls/${encodeURIComponent(sid)}`,
        { method: 'GET', timeoutMs: TIMEOUTS.listCalls },
      );
    } catch {
      // A 404 for an unknown SID is an ordinary answer here, not a fault.
      return null;
    }
    const [call] = parseCalls({ calls: [data] });
    return call ?? null;
  }

  /**
   * Recordings, optionally for one call.
   *
   * With no `callSid` this is account-wide — there is no per-company filter, because
   * a recording belongs to a call, not to a number. The timeline uses it that way and
   * reads ONLY `call_sid`, matching against calls it has already established belong to
   * the company; no other field of another company's row is ever surfaced.
   */
  async listRecordings(
    opts: {
      callSid?: string;
      /**
       * Epoch ms upper bound, for the ACCOUNT-WIDE use.
       *
       * Without it the account-wide call is one unpaginated page of the newest
       * `PageSize` recordings, whatever window the caller actually wants. Once the
       * account holds more than a page, older recordings drop out of the result and a
       * timeline row silently reports "no recording" while `listRecordings({callSid})`
       * still finds the audio — the list and the detail view then disagree, and nothing
       * detects it. Passing the window's own bound is what keeps them in step.
       *
       * Same `DateCreated<` shape as `StartTime<` on /Calls, and the same rule: send the
       * FULL ISO datetime, never a bare date. Omitted when undefined, so an account-wide
       * call with no bound behaves exactly as it did before.
       */
      before?: number;
      pageSize?: number;
    } = {},
  ): Promise<SwRecording[]> {
    const data = await this.call(
      `listRecordings${opts.callSid ? ' call=' + opts.callSid : ' (account)'}`,
      '/Recordings',
      {
        method: 'GET',
        query: {
          CallSid: opts.callSid,
          'DateCreated<': isoOrUndefined(opts.before),
          PageSize: String(opts.pageSize ?? DEFAULT_PAGE_SIZE),
        },
        timeoutMs: TIMEOUTS.listRecordings,
      },
    );
    return parseRecordings(data);
  }

  /**
   * Pause or resume an IN-PROGRESS recording.
   *
   * Used while a caller is on hold: the hold music is transmitted by the agent browser,
   * so record-from-answer-dual would capture it. PauseBehavior=skip removes the held span
   * from the file entirely; the alternative, "silence", keeps its duration as dead air.
   *
   * Returns a boolean rather than throwing, because every caller treats this as
   * best-effort -- see the hold route. A caller left in silence because a provider call
   * failed is a far worse outcome than a recording that contains music.
   */
  async updateRecording(
    callSid: string,
    recordingSid: string,
    status: 'paused' | 'in-progress',
  ): Promise<boolean> {
    try {
      await this.call(
        `updateRecording ${recordingSid} ${status}`,
        `/Calls/${encodeURIComponent(callSid)}/Recordings/${encodeURIComponent(recordingSid)}`,
        {
          method: 'POST',
          form: {
            Status: status,
            // Only meaningful when pausing; call() drops undefined keys.
            PauseBehavior: status === 'paused' ? 'skip' : undefined,
          },
          timeoutMs: TIMEOUTS.updateRecording,
        },
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `updateRecording ${recordingSid} -> ${status} failed: ${String(err)}`,
      );
      return false;
    }
  }
  /**
   * Downloads a recording's audio.
   *
   * Deliberately NOT routed through `call()`: that method does `JSON.parse` on the
   * response text, which would corrupt MP3 bytes into a thrown error at best and a
   * mangled buffer at worst. This is the one place the shared transport genuinely
   * does not fit.
   *
   * SignalWire serves this URL without authentication — which is exactly why the
   * browser must never be given it. An unauthenticated, permanent, guess-resistant
   * URL to a client's recorded phone call is not something to hand out; our own route
   * proxies these bytes behind the usual token check.
   */
  async fetchRecordingMedia(
    sid: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const url = `${this.baseUrl}/Recordings/${encodeURIComponent(sid)}.mp3`;
    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: this.authHeader },
        signal: AbortSignal.timeout(
          this.timeoutOverride ?? TIMEOUTS.fetchRecording,
        ),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : 'Error';
      this.logger.error(
        `fetchRecordingMedia ${sid} FAILED ${name} ${Date.now() - started}ms`,
      );
      throw new BadGatewayException('Recording could not be fetched');
    }

    if (!res.ok) {
      this.logger.warn(
        `fetchRecordingMedia ${sid} ${res.status} ${Date.now() - started}ms`,
      );
      throw new NotFoundException('Recording not found');
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    this.logger.log(
      `fetchRecordingMedia ${sid} ${res.status} ${Date.now() - started}ms ${buffer.length}B`,
    );
    return {
      buffer,
      contentType: res.headers.get('content-type') ?? 'audio/mpeg',
    };
  }

  /** Sends an SMS. `from` must be a number this account owns. */
  async sendSms(input: {
    to: string;
    from: string;
    body: string;
  }): Promise<SwMessage> {
    const data = await this.call(`sendSms to=${input.to}`, '/Messages', {
      method: 'POST',
      form: { To: input.to, From: input.from, Body: input.body },
      timeoutMs: TIMEOUTS.sendSms,
    });
    const [message] = parseMessages({ messages: [data] });
    if (!message) {
      // The send may well have gone out; we just cannot report its id back.
      this.logger.error(
        `sendSms to ${input.to} returned an unreadable body — the message may have been sent`,
      );
      throw new BadGatewayException(
        'Phone service returned an unreadable send response',
      );
    }
    return message;
  }

  /**
   * Originates a call, with the instructions supplied INLINE.
   *
   * `Laml` (SignalWire's synonym for Twilio's `Twiml`) carries the `<Dial>` in the
   * request itself, so click-to-call needs no publicly reachable callback URL. That
   * matters beyond tidiness: a `Url` webhook would have to carry the customer's
   * number, and this module's webhook signatures are computed over the exact URL
   * including its query string — making the signature base depend on parameter order
   * and encoding. Wrong guesses about that signature have already cost two deploy
   * cycles here, so the safest webhook is the one that does not exist.
   */
  async createCall(input: {
    to: string;
    from: string;
    laml: string;
    statusCallback?: string;
    timeoutSec?: number;
  }): Promise<SwCall> {
    const data = await this.call(`createCall to=${input.to}`, '/Calls', {
      method: 'POST',
      form: {
        To: input.to,
        From: input.from,
        Laml: input.laml,
        StatusCallback: input.statusCallback,
        StatusCallbackMethod: input.statusCallback ? 'POST' : undefined,
        Timeout: String(input.timeoutSec ?? 30),
      },
      timeoutMs: TIMEOUTS.createCall,
    });
    const [created] = parseCalls({ calls: [data] });
    if (!created) {
      // A call may be ringing that we cannot report on. Name it in the log.
      this.logger.error(
        `createCall to ${input.to} returned an unreadable body — a call may be in progress`,
      );
      throw new BadGatewayException(
        'Phone service returned an unreadable call response',
      );
    }
    return created;
  }
}
