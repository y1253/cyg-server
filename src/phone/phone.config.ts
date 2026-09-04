import type { IsoCountry } from './signalwire-parse.js';

/**
 * Region defaults, and why this file exists at all.
 *
 * The plan originally assumed the country in the search URL selected US vs Canada. It
 * does not: verified against the live API, `/CA/Local`, `/GB/Local` and even `/XX/Local`
 * all return the same New Jersey numbers, and the `iso_country` field reports "US" even
 * for Montreal numbers. The ONLY thing that actually filters geographically is
 * `InRegion` (province / state) or `AreaCode`.
 *
 * So a company's country selects a REGION LIST, and we walk it until a region has
 * inventory that meets our capability bar. Canada defaults to Quebec first because the
 * firm is Quebec-based — the schema is full of QC-specific fields (NEQ, revenueQcId,
 * RL-1, CNESST).
 *
 * The US list is deliberately EMPTY by default, which means "search without a region
 * filter". Today that is academic: no US number on the account is SMS-capable (A2P
 * 10DLC registration is pending), so every US candidate is rejected by the capability
 * filter regardless of region. Once 10DLC completes, set PHONE_DEFAULT_REGIONS_US to
 * the states you actually want to serve, rather than accepting whatever the unfiltered
 * search returns first.
 */
const FALLBACK_REGIONS: Record<IsoCountry, string[]> = {
  CA: ['QC', 'ON', 'BC', 'AB'],
  US: [],
};

/**
 * Parses a comma-separated region list from the environment.
 *
 * Returns `[]` for an unset or blank value, which callers treat as "no region filter"
 * rather than as an error — an empty list is a meaningful configuration, not a mistake.
 */
export function parseRegions(csv: string | undefined | null): string[] {
  return (csv ?? '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter((r) => /^[A-Z]{2}$/.test(r));
}

/**
 * The regions to try, in order, for a company in this country.
 *
 * An explicit env override always wins. An empty result means "search unfiltered" —
 * expressed as a single `undefined` entry by the caller, not as "give up".
 */
export function regionsFor(
  country: IsoCountry,
  env: Record<string, string | undefined>,
): string[] {
  const override = parseRegions(
    env[
      country === 'CA' ? 'PHONE_DEFAULT_REGIONS_CA' : 'PHONE_DEFAULT_REGIONS_US'
    ],
  );
  return override.length > 0 ? override : FALLBACK_REGIONS[country];
}

/**
 * The webhook base SignalWire should call back on.
 *
 * Separate from CALLBACK_BASE_URL on purpose: that variable also builds the Google and
 * Microsoft OAuth redirect URIs, which are registered verbatim in the Google Cloud
 * Console and the Azure app registration. Repointing it at an ngrok tunnel to develop
 * phone webhooks would silently break connecting a mailbox.
 */
export function webhookBase(env: Record<string, string | undefined>): string {
  // `??` alone is wrong here: an env var declared but left blank (`PHONE_WEBHOOK_BASE_URL=`)
  // is an empty STRING, which `??` happily returns — yielding relative callback URLs that
  // SignalWire cannot fetch at all. Unlike a settings override, where "" is a value an
  // admin chose, a blank env var means "not configured", so blanks fall through.
  const first = [env.PHONE_WEBHOOK_BASE_URL, env.CALLBACK_BASE_URL].find(
    (value) => (value ?? '').trim() !== '',
  );
  return (first ?? 'http://localhost:3000').trim().replace(/\/+$/, '');
}

/**
 * Every URL SignalWire may call back on.
 *
 * The first three are what a purchased number is CONFIGURED with; the last two are
 * named inside LaML at call time. They live together because the signature check
 * rebuilds the signed URL from this function rather than from the incoming request —
 * behind nginx req.protocol is http and the host header can carry a port, either of
 * which changes the signed string. A route missing from here cannot be verified.
 *
 * None of them carry a query string, deliberately: the signature base includes the
 * full URL including its query, so a signed value that depends on parameter order and
 * encoding is a trap (see phone-dialer.service.ts). Everything these two need arrives
 * in the POST body.
 */
export function webhookUrls(env: Record<string, string | undefined>) {
  const base = webhookBase(env);
  return {
    voiceUrl: `${base}/api/phone/voice/inbound`,
    smsUrl: `${base}/api/phone/sms/inbound`,
    statusCallback: `${base}/api/phone/voice/status`,
    dialStatusUrl: `${base}/api/phone/voice/dial-status`,
    voicemailUrl: `${base}/api/phone/voice/voicemail`,
  };
}

/**
 * The daily ceiling on AUTOMATIC purchases.
 *
 * `POST /api/companies/register` is public and unauthenticated, so auto-buy on that path
 * is an open money faucet. This is a budget, not a feature flag — but setting it to 0
 * does cleanly disable auto-provisioning for local development. Admin-initiated
 * purchases are never capped: those are authenticated and deliberate.
 */
export function maxPurchasesPerDay(
  env: Record<string, string | undefined>,
): number {
  const raw = parseInt(env.PHONE_MAX_PURCHASES_PER_DAY ?? '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 10;
}

/**
 * The browser softphone's SIP credentials.
 *
 * ── THE DOMAIN IS NOT DERIVED FROM THE SPACE URL. ───────────────────────────────
 * It is `{space}-{projectIdTail}.sip.signalwire.com`, and it is read from the
 * environment precisely so nobody re-derives it. Guessing `{space}.sip.signalwire.com`
 * cost this increment several days: that host RESOLVES, serves a valid TLS certificate,
 * upgrades a WebSocket to the `sip` subprotocol, and answers REGISTER with a correct
 * digest challenge. It simply has no users on it — and a registrar answers 401 for an
 * unknown user rather than revealing the user does not exist, so a wrong domain is
 * indistinguishable from a wrong password. Five endpoints across two APIs and two
 * independent SIP clients all failed identically before the dashboard showed the real
 * value on the SIP Credential page.
 *
 * ── ONE CREDENTIAL, SHARED BY EVERY BROWSER. ───────────────────────────────────
 * SIP passwords cannot be set through ANY SignalWire API (verified against the correct
 * domain: dashboard-created credentials register, API-created ones never do), so a
 * credential per user would mean a manual dashboard entry per user. Sharing one avoids
 * that entirely. The consequence is that SignalWire rings a CREDENTIAL, not a person:
 * every registered browser receives every INVITE, so which user is *shown* the call is
 * decided by the SSE payload in the client, not by who got the INVITE.
 * The registrar accumulates contacts (verified: two clients, two bindings), which is
 * what makes one credential ring several browsers at once.
 */
export function sipCredentials(env: Record<string, string | undefined>): {
  domain: string;
  username: string;
  password: string;
  wsServer: string;
} | null {
  const domain = env.SIGNALWIRE_SIP_DOMAIN?.trim();
  const username = env.SIGNALWIRE_SIP_USERNAME?.trim();
  const password = env.SIGNALWIRE_SIP_PASSWORD;
  // All three or nothing: a partially configured softphone fails at REGISTER, which
  // looks identical to "no calls today". Null lets the caller say so explicitly.
  if (!domain || !username || !password) return null;
  return { domain, username, password, wsServer: `wss://${domain}` };
}

/** The SIP URI the inbound webhook dials to reach every registered browser. */
export function sipDialTarget(
  env: Record<string, string | undefined>,
): string | null {
  const creds = sipCredentials(env);
  return creds ? `${creds.username}@${creds.domain}` : null;
}

/**
 * The `record` attribute to put on `<Dial>`, or undefined to record nothing.
 *
 * `record-from-answer-dual` puts each party on its own channel, which is what makes a
 * recording worth listening to. Both the inbound ring group and the outbound bridge
 * use this one value — recording only one direction would make "click a call, hear the
 * recording" work for half the timeline, which is worse than not offering it.
 *
 * Behind a flag because this is not purely a technical choice: recordings are billed
 * per minute plus storage, and recording a call carries consent obligations that vary
 * by jurisdiction. `PHONE_RECORD_CALLS=0` turns it off without a code change, and
 * omits the attribute entirely rather than sending `do-not-record`, so the LaML is
 * byte-identical to what shipped before recording existed.
 */
export function recordMode(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.PHONE_RECORD_CALLS === '0' ? undefined : 'record-from-answer-dual';
}

/**
 * Is AI summarisation of call recordings switched on?
 *
 * ⚠️ Note the DELIBERATE INVERSION from `recordMode` above: that one is default-ON and
 * disabled by `'0'`; this one is default-OFF and enabled by `'1'`. Recording keeps the
 * audio on our own provider account and is a storage and consent decision. Summarising
 * bills per minute of audio AND ships a client's recorded conversation to a third party
 * (OpenAI). Those are not the same risk, so they do not get the same default.
 *
 * The flag is also the rollback: flip it and the sweep stops claiming rows, with no
 * deploy. Rows already written stay PENDING and resume if it is turned back on.
 */
export function summarizeCalls(
  env: Record<string, string | undefined>,
): boolean {
  return env.PHONE_SUMMARIZE_CALLS === '1';
}

/**
 * Model ids for the two OpenAI calls a summary needs.
 *
 * The summary model falls back to `OPENAI_POLISH_MODEL` before the hardcoded default, so
 * an operator who has already pinned a chat model for AI polish does not have to pin it
 * twice — but can still separate them, since summarising a transcript and rewriting an
 * email are different jobs and may deserve different models.
 */
export function transcribeModel(
  env: Record<string, string | undefined>,
): string {
  const raw = (env.OPENAI_TRANSCRIBE_MODEL ?? '').trim();
  return raw !== '' ? raw : 'whisper-1';
}

export function summaryModel(env: Record<string, string | undefined>): string {
  for (const candidate of [env.OPENAI_SUMMARY_MODEL, env.OPENAI_POLISH_MODEL]) {
    const raw = (candidate ?? '').trim();
    if (raw !== '') return raw;
  }
  return 'gpt-4o-mini';
}
