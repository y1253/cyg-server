/**
 * SignalWire API probe — Phase 0 of the phone system.
 *
 * READ-ONLY. Searches and lists only. It never purchases, updates or deletes
 * anything, so running it costs nothing. Do not add a purchase call here: the
 * first real buy is done by hand (plan step 5) so it can be watched.
 *
 *   cd server
 *   node --env-file=.env scripts/signalwire-probe.mjs
 *
 * What it pins down, because the docs are thin or inconsistent on all four:
 *   1. that Basic auth works against the bare space host in SIGNALWIRE_SPACE_URL
 *   2. the `available_phone_numbers` shape for CA and US
 *   3. THE CAPABILITY KEY CASING — docs show `voice` lowercase but `SMS`/`MMS`
 *      uppercase on search. Capabilities gate number selection, so guessing wrong
 *      filters out every result and looks like "no numbers available".
 *   4. whether `AreaCode` narrows the CA search (the admin picker depends on it)
 *
 * Prints raw status + raw body for every call: never res.json(), because the point
 * is to discover the schema, not to assume it.
 *
 * Delete this file once the findings are recorded in CLAUDE.md.
 */

const SPACE = process.env.SIGNALWIRE_SPACE_URL;
const PROJECT = process.env.SIGNALWIRE_PROJECT_ID;
const TOKEN = process.env.SIGNALWIRE_API_TOKEN;

for (const [k, v] of Object.entries({ SIGNALWIRE_SPACE_URL: SPACE, SIGNALWIRE_PROJECT_ID: PROJECT, SIGNALWIRE_API_TOKEN: TOKEN })) {
  if (!v) { console.error(`${k} missing from server/.env`); process.exit(1); }
}

// The env var holds a BARE host (cygfinance.signalwire.com). If someone pastes a
// full URL in later, strip it rather than building https://https://...
const host = SPACE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const BASE = `https://${host}/api/laml/2010-04-01/Accounts/${PROJECT}`;
const AUTH = 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');

async function call(label, path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const t0 = Date.now();
  let status = '-';
  let body = '';
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    body = `${err.name}: ${err.message}`;
  }
  console.log(`\n=== ${label} ===`);
  console.log(`GET ${url.pathname}${url.search}`);
  console.log(`${status}  ${Date.now() - t0}ms`);
  console.log(body.slice(0, 2000));
  return body;
}

/** Report the EXACT capability keys as returned, so casing is observed not assumed. */
function reportCapabilityKeys(label, raw) {
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  const list = data?.available_phone_numbers ?? data?.incoming_phone_numbers;
  if (!Array.isArray(list) || list.length === 0) {
    console.log(`\n--- ${label}: no rows to inspect ---`);
    return;
  }
  console.log(`\n--- ${label}: ${list.length} rows ---`);
  console.log('row[0] keys      :', Object.keys(list[0]).join(', '));
  console.log('capability keys  :', JSON.stringify(list[0].capabilities));
  console.log('sample           :', JSON.stringify({
    phone_number: list[0].phone_number,
    region: list[0].region,
    rate_center: list[0].rate_center,
    iso_country: list[0].iso_country,
  }));
}

console.log(`space   : ${host}`);
console.log(`project : ${PROJECT.slice(0, 8)}…`);

// 1. Auth check + what we already own. Read-only and free.
const owned = await call('auth check / owned numbers', '/IncomingPhoneNumbers', { PageSize: '5' });
reportCapabilityKeys('owned', owned);

// 2. The AUTO-PROVISION path: country only, no AreaCode.
const ca = await call('search CA local (country only)', '/AvailablePhoneNumbers/CA/Local');
reportCapabilityKeys('CA country-only', ca);

// 3. The ADMIN path: country + a typed area code.
const ca514 = await call('search CA local AreaCode=514', '/AvailablePhoneNumbers/CA/Local', { AreaCode: '514' });
reportCapabilityKeys('CA 514', ca514);

// 4. US, to confirm the other branch of toIsoCountry resolves.
const us = await call('search US local (country only)', '/AvailablePhoneNumbers/US/Local');
reportCapabilityKeys('US country-only', us);

console.log('\nDone. Nothing was purchased, updated or deleted.');
