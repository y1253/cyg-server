/**
 * Is there ANY SMS-capable US inventory to buy right now?
 *
 * READ-ONLY. Searches only — it never purchases, updates or deletes, so running it costs
 * nothing.
 *
 *   ssh root@87.99.134.152
 *   cd ~/cyg-server && node --env-file=.env scripts/signalwire-us-inventory-probe.mjs
 *
 * ⚠️ MUST RUN ON HETZNER. The office network's TLS-intercepting proxy makes SignalWire
 * unreachable from a dev machine (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`).
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────
 * A support number must do voice AND SMS (`eligible()`), and CLAUDE.md records a sampling
 * of 2,200+ US numbers across 22 states with ZERO SMS-capable, because A2P 10DLC is
 * pending. Meanwhile the code never really looked: `FALLBACK_REGIONS.US` is empty, so a US
 * search makes ONE unfiltered request — and since SignalWire ignores the country segment
 * in the URL, that always lands in New Jersey.
 *
 * So before changing the state list there are two different questions to separate:
 *   1. does the US have SMS-capable local inventory ANYWHERE (is the state list worth it)?
 *   2. is TOLL-FREE SMS-capable? It is separate inventory under a different verification
 *      regime, and the one plausible way to get a textable US number before 10DLC clears.
 *
 * If both answers are no, the honest outcome is that no code change can buy a US number
 * today, and the app should say exactly that instead of "no numbers available".
 *
 * Prints a compact table plus a verdict. Delete once the finding is recorded in CLAUDE.md.
 */

const SPACE = process.env.SIGNALWIRE_SPACE_URL;
const PROJECT = process.env.SIGNALWIRE_PROJECT_ID;
const TOKEN = process.env.SIGNALWIRE_API_TOKEN;

for (const [k, v] of Object.entries({
  SIGNALWIRE_SPACE_URL: SPACE,
  SIGNALWIRE_PROJECT_ID: PROJECT,
  SIGNALWIRE_API_TOKEN: TOKEN,
})) {
  if (!v) {
    console.error(`${k} missing from server/.env`);
    process.exit(1);
  }
}

const host = SPACE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const BASE = `https://${host}/api/laml/2010-04-01/Accounts/${PROJECT}`;
const AUTH = 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');

/** Every state worth trying, roughly by market size. */
const STATES = [
  'NY', 'NJ', 'CA', 'FL', 'TX', 'IL', 'PA', 'OH', 'GA', 'NC',
  'MI', 'WA', 'MA', 'AZ', 'VA', 'TN', 'IN', 'MO', 'MD', 'CO',
  'MN', 'WI', 'NV', 'OR', 'CT',
];

/**
 * Case-insensitive, matching `capabilityOf` in `signalwire-parse.ts` — the live API sends
 * `voice` lowercase but `SMS`/`MMS` UPPERCASE, and reading it the naive way is what makes
 * a capability probe silently report zero.
 */
function capable(caps, name) {
  if (!caps || typeof caps !== 'object') return null;
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(caps)) {
    if (key.toLowerCase() === wanted) {
      return typeof value === 'boolean' ? value : null;
    }
  }
  return null;
}

async function search(path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    return { rows: data?.available_phone_numbers ?? [] };
  } catch (err) {
    return { error: `${err.name}: ${err.message}` };
  }
}

function tally(rows) {
  let voice = 0;
  let sms = 0;
  let both = 0;
  const sample = [];
  for (const r of rows) {
    const v = capable(r.capabilities, 'voice') === true;
    const s = capable(r.capabilities, 'sms') === true;
    if (v) voice++;
    if (s) sms++;
    // Exactly the `eligible()` bar.
    if (v && s) {
      both++;
      if (sample.length < 3) sample.push(r.phone_number);
    }
  }
  return { total: rows.length, voice, sms, both, sample };
}

console.log('US inventory probe — read-only, no purchases\n');
console.log('state    total  voice    sms   BOTH  sample');
console.log('-------------------------------------------------------------');

let anyLocal = 0;
const winners = [];

for (const state of STATES) {
  const res = await search('/AvailablePhoneNumbers/US/Local', {
    InRegion: state,
    PageSize: '50',
  });
  if (res.error) {
    console.log(`${state.padEnd(6)}  ${res.error}`);
    continue;
  }
  const t = tally(res.rows);
  anyLocal += t.both;
  if (t.both > 0) winners.push(`${state} (${t.both})`);
  console.log(
    `${state.padEnd(6)} ${String(t.total).padStart(6)} ${String(t.voice).padStart(6)} ` +
      `${String(t.sms).padStart(6)} ${String(t.both).padStart(6)}  ${t.sample.join(' ')}`,
  );
}

// Separate inventory, separate verification regime — the real question.
console.log('\n--- toll-free ---');
const tf = await search('/AvailablePhoneNumbers/US/TollFree', { PageSize: '50' });
let tollFreeBoth = 0;
if (tf.error) {
  console.log(`toll-free: ${tf.error}`);
} else {
  const t = tally(tf.rows);
  tollFreeBoth = t.both;
  console.log(
    `total=${t.total} voice=${t.voice} sms=${t.sms} BOTH=${t.both}  ${t.sample.join(' ')}`,
  );
}

console.log('\n=== VERDICT ===');
if (anyLocal > 0) {
  console.log(`SMS-capable US LOCAL numbers exist: ${winners.join(', ')}`);
  console.log('→ Add those states to FALLBACK_REGIONS.US and a US company can buy today.');
} else if (tollFreeBoth > 0) {
  console.log(`No SMS-capable local numbers, but ${tollFreeBoth} toll-free qualify.`);
  console.log('→ Local stays blocked until 10DLC; toll-free is the route worth pursuing.');
} else {
  console.log('NOTHING in the US clears voice+SMS — local or toll-free.');
  console.log('→ This is a carrier rule, not our filter. No state list can fix it, and no');
  console.log('  code change will buy a US number until A2P 10DLC verification completes.');
  console.log('  Ship only the honest empty-state message.');
}
