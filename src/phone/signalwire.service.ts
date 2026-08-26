import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  parseAvailableNumbers,
  parseOwnedNumbers,
  parsePurchasedNumber,
  signalwireErrorMessage,
  type AvailableNumber,
  type IsoCountry,
  type PurchasedNumber,
  type SignalWireJson,
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
} as const;

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
}
