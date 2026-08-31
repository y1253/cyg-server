/**
 * SignalWire timeline probe, round 2 — the four questions round 1 left open.
 *
 * READ-ONLY. Must be run from a host OUTSIDE the office network: the TLS-intercepting
 * content filter there makes Node's fetch fail with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 *   ssh root@… "cd ~/cyg-server && node --env-file=.env /tmp/probe2.mjs"
 *
 * A. Is the `StartTime<` / `DateSent<` comparator TIME-sensitive or DATE-only?
 *    Round 1 was inconclusive — both variants hit the PageSize cap. Redone here with
 *    a page size far above the row count so the totals are real.
 * B. Does `To=sip:user@domain` work as a Calls filter? This is how missed INBOUND
 *    calls are detected: the parent leg reports `completed` even when nobody picked
 *    up, and only the SIP child leg carries `no-answer`.
 * C. Does `Messages?To=X&From=Y` apply BOTH filters, or silently ignore one? The SMS
 *    thread view depends on it.
 * D. Is PageSize=200 honoured, or clamped?
 */

const SPACE = process.env.SIGNALWIRE_SPACE_URL;
const PROJECT = process.env.SIGNALWIRE_PROJECT_ID;
const TOKEN = process.env.SIGNALWIRE_API_TOKEN;
const SIP_USER = process.env.SIGNALWIRE_SIP_USERNAME;
const SIP_DOMAIN = process.env.SIGNALWIRE_SIP_DOMAIN;

const host = SPACE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const BASE = `https://${host}/api/laml/2010-04-01/Accounts/${PROJECT}`;
const AUTH = 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');

async function get(path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const res = await fetch(url, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* leave null */
  }
  return { status: res.status, json, text, search: url.search };
}

const rows = (j, key) => (Array.isArray(j?.[key]) ? j[key] : []);

console.log(`sip = ${SIP_USER}@${SIP_DOMAIN}`);

// ── D. PageSize ─────────────────────────────────────────────────────────────
const big = await get('/Calls', { PageSize: '200' });
console.log(`\n=== D. PageSize=200 ===`);
console.log(`  page_size echoed: ${big.json?.page_size}`);
console.log(`  rows returned:    ${rows(big.json, 'calls').length}`);
console.log(`  next_page_uri:    ${big.json?.next_page_uri ?? 'null (all rows fit)'}`);

const all = rows(big.json, 'calls');
console.log(`\n  total calls on account (first page): ${all.length}`);
const byDir = {};
for (const c of all) byDir[c.direction] = (byDir[c.direction] ?? 0) + 1;
console.log(`  by direction: ${JSON.stringify(byDir)}`);
const sipLegs = all.filter((c) => String(c.to).startsWith('sip:'));
const pstnLegs = all.filter((c) => !String(c.to).startsWith('sip:'));
console.log(`  legs whose "to" is a SIP URI: ${sipLegs.length}`);
console.log(`  legs whose "to" is a number:  ${pstnLegs.length}`);

// ── A. Date filter precision ────────────────────────────────────────────────
// Pick a day that actually has calls, then compare "< that day" against
// "< that day at 23:59:59Z". If the time is honoured the second is strictly larger.
console.log(`\n=== A. Date filter precision ===`);
if (all.length === 0) {
  console.log('  no calls — cannot test');
} else {
  const times = all
    .map((c) => new Date(c.start_time).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const mid = times[Math.floor(times.length / 2)];
  const day = new Date(mid).toISOString().slice(0, 10);
  const dayStart = `${day}T00:00:00Z`;
  const dayEnd = `${day}T23:59:59Z`;

  for (const [label, value] of [
    ['date only          ', day],
    ['ISO @ 00:00:00Z    ', dayStart],
    ['ISO @ 23:59:59Z    ', dayEnd],
  ]) {
    const r = await get('/Calls', { 'StartTime<': value, PageSize: '200' });
    console.log(`  StartTime< ${label} (${value}) -> ${rows(r.json, 'calls').length} rows  [${r.status}]`);
  }
  console.log(`  (probe day = ${day})`);
  console.log('  If 00:00:00Z and 23:59:59Z differ, the TIME IS HONOURED.');
  console.log('  If all three are equal, only the DATE is read -> filter exactly in memory.');
}

// ── B. SIP `To` filter ──────────────────────────────────────────────────────
console.log(`\n=== B. Calls?To=sip:… ===`);
if (!SIP_USER || !SIP_DOMAIN) {
  console.log('  SIGNALWIRE_SIP_USERNAME / _DOMAIN not set — skipped');
} else {
  const sipUri = `sip:${SIP_USER}@${SIP_DOMAIN}`;
  const r = await get('/Calls', { To: sipUri, PageSize: '200' });
  const got = rows(r.json, 'calls');
  console.log(`  To=${sipUri} -> ${got.length} rows  [${r.status}]`);
  console.log(`  (unfiltered SIP-to legs on page 1 was ${sipLegs.length})`);
  if (got.length > 0) {
    const c = got[0];
    console.log(`  sample: status=${c.status} direction=${c.direction} parent=${c.parent_call_sid} dur=${c.duration}`);
    console.log(`  statuses seen: ${[...new Set(got.map((x) => x.status))].join(', ')}`);
    console.log(`  every row has parent_call_sid? ${got.every((x) => !!x.parent_call_sid)}`);
  }
  if (got.length === 0 && sipLegs.length > 0) {
    console.log('  !! FILTER IGNORED or unsupported for SIP URIs — fall back to per-call ParentCallSid lookup');
  }
}

// ── Parent/child pairing sanity ─────────────────────────────────────────────
console.log(`\n=== Parent/child pairing ===`);
const parents = new Map(all.map((c) => [c.sid, c]));
const children = all.filter((c) => c.parent_call_sid);
console.log(`  child legs on page 1: ${children.length}`);
for (const ch of children.slice(0, 6)) {
  const p = parents.get(ch.parent_call_sid);
  console.log(
    `   child ${ch.status.padEnd(12)} dur=${String(ch.duration).padStart(4)} to=${String(ch.to).slice(0, 46)}` +
      (p ? `\n     parent ${p.status.padEnd(11)} dur=${String(p.duration).padStart(4)} to=${p.to} from=${p.from} dir=${p.direction}` : '\n     parent NOT on this page'),
  );
}

// ── C. Messages To + From together ──────────────────────────────────────────
console.log(`\n=== C. Messages?To=&From= together ===`);
const msgs = rows((await get('/Messages', { PageSize: '200' })).json, 'messages');
console.log(`  total messages (page 1): ${msgs.length}`);
if (msgs.length === 0) {
  console.log('  no messages — cannot test');
} else {
  const m = msgs[0];
  console.log(`  sample: to=${m.to} from=${m.from} direction=${m.direction} status=${m.status}`);
  const onlyTo = rows((await get('/Messages', { To: m.to, PageSize: '200' })).json, 'messages');
  const onlyFrom = rows((await get('/Messages', { From: m.from, PageSize: '200' })).json, 'messages');
  const both = rows((await get('/Messages', { To: m.to, From: m.from, PageSize: '200' })).json, 'messages');
  const bogus = rows(
    (await get('/Messages', { To: m.to, From: '+15005550001', PageSize: '200' })).json,
    'messages',
  );
  console.log(`  To only:           ${onlyTo.length}`);
  console.log(`  From only:         ${onlyFrom.length}`);
  console.log(`  To + From:         ${both.length}`);
  console.log(`  To + bogus From:   ${bogus.length}  <-- MUST be 0 if both filters apply`);
  console.log(
    bogus.length === 0
      ? '  => BOTH filters are applied. sms-thread can query the pair directly.'
      : '  => From is IGNORED alongside To. sms-thread must filter the peer in memory.',
  );
  console.log(`  directions seen: ${[...new Set(msgs.map((x) => x.direction))].join(', ')}`);
  const mms = msgs.find((x) => Number(x.num_media) > 0);
  if (mms) {
    const media = await get(`/Messages/${mms.sid}/Media`, { PageSize: '5' });
    console.log(`  media envelope keys: ${Object.keys(media.json ?? {}).join(', ')}`);
  } else {
    console.log('  no MMS on the account — media_list still unverified');
  }
}

console.log('\ndone.');
