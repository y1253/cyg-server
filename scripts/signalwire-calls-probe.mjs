/**
 * SignalWire Calls / Messages / Recordings probe — phase 0 of the phone timeline.
 *
 * READ-ONLY. Lists only. It never creates a call, sends a message or deletes
 * anything, so running it costs nothing.
 *
 *   cd server
 *   node --env-file=.env scripts/signalwire-calls-probe.mjs
 *
 * What it pins down, because the docs for this API have already been wrong on five
 * separate points for this account:
 *   1. THE SID FORMAT — Twilio-style `CA…`/`SM…`/`RE…`, or a bare uuid. The inbox
 *      keys per-item read/completed state on this, and uses it as the React key.
 *   2. Whether `StartTime<` / `DateSent<` honour a FULL ISO DATETIME or only
 *      YYYY-MM-DD. The timeline cursor is a timestamp; if only the date part is
 *      read, the service must filter exactly in memory.
 *   3. The list keys: `calls`, `messages`, `recordings` — and `media_list`, which
 *      the docs say is NOT `media`.
 *   4. Whether a recording `.mp3` is really fetchable with no auth (docs claim yes
 *      for the media, no for the `.json`). We proxy it either way, but a documented
 *      absence of auth is worth testing before relying on it.
 *   5. That `direction` and `status` on real rows match the documented sets.
 *
 * Prints raw status + raw body: never res.json(), because the point is to discover
 * the schema rather than assume it.
 *
 * Delete this file once the findings are recorded in CLAUDE.md.
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

const MAX_BODY = 1500;

async function call(label, path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const t0 = Date.now();
  let status = '-';
  let body = '';
  let ct = '-';
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: AUTH, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    status = res.status;
    ct = res.headers.get('content-type') ?? '-';
    body = await res.text();
  } catch (err) {
    body = `${err.name}: ${err.message}`;
  }
  console.log(`\n=== ${label} ===`);
  console.log(`GET ${url.pathname}${url.search}`);
  console.log(`${status}  ${Date.now() - t0}ms  ct=${ct}`);
  console.log(
    body.length > MAX_BODY
      ? body.slice(0, MAX_BODY) + `\n… (${body.length} bytes total)`
      : body,
  );
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/** Summarise a list response's shape without dumping every row. */
function summarise(label, data, listKey) {
  console.log(`\n--- ${label}: shape ---`);
  if (!data || typeof data !== 'object') {
    console.log('  (unparseable)');
    return [];
  }
  console.log(`  envelope keys: ${Object.keys(data).join(', ')}`);
  const list = data[listKey];
  if (!Array.isArray(list)) {
    console.log(`  !! "${listKey}" is NOT an array — it is ${typeof list}`);
    return [];
  }
  console.log(`  ${listKey}.length = ${list.length}`);
  if (list.length > 0) {
    console.log(`  row keys: ${Object.keys(list[0]).join(', ')}`);
    console.log(`  row[0]: ${JSON.stringify(list[0], null, 2).slice(0, 1000)}`);
  }
  return list;
}

const iso = (d) => new Date(d).toISOString();
const dayOf = (d) => iso(d).slice(0, 10);
const uniq = (arr) => [...new Set(arr)].join(', ');

const now = Date.now();

console.log(`space=${host}`);
console.log(`project=${PROJECT}`);
console.log(`now=${iso(now)}`);

// ── 1. Calls ────────────────────────────────────────────────────────────────
const calls = summarise(
  'Calls (unfiltered)',
  await call('Calls unfiltered', '/Calls', { PageSize: '5' }),
  'calls',
);

if (calls.length > 0) {
  const sids = calls.map((c) => c.sid);
  console.log(`\n>>> CALL SIDS: ${sids.map((s) => `${s} (len ${s.length})`).join(' | ')}`);
  console.log(`>>> Twilio-style (CA + 32 hex)? ${sids.every((s) => /^CA[0-9a-f]{32}$/i.test(s))}`);
  console.log(`>>> uuid?                       ${sids.every((s) => /^[0-9a-f-]{36}$/i.test(s))}`);
  console.log(`>>> directions: ${uniq(calls.map((c) => c.direction))}`);
  console.log(`>>> statuses:   ${uniq(calls.map((c) => c.status))}`);
  console.log(`>>> start_time sample: ${JSON.stringify(calls[0].start_time)}`);
  console.log(`>>> duration sample:   ${JSON.stringify(calls[0].duration)}`);
}

// ── 2. THE DATE-FILTER PRECISION QUESTION ───────────────────────────────────
// Ask for calls before a moment ~1h ago, two ways. If the full ISO datetime is
// honoured the answers differ whenever a call happened earlier today; if only the
// date part is read they are identical.
const cutoff = now - 3600000;
console.log(`\n########## DATE FILTER PRECISION (cutoff = ${iso(cutoff)}) ##########`);
const byDate = summarise(
  'Calls StartTime< date-only',
  await call('Calls StartTime< date', '/Calls', {
    'StartTime<': dayOf(cutoff),
    PageSize: '20',
  }),
  'calls',
);
const byDatetime = summarise(
  'Calls StartTime< full ISO',
  await call('Calls StartTime< iso', '/Calls', {
    'StartTime<': iso(cutoff),
    PageSize: '20',
  }),
  'calls',
);
console.log(`\n>>> date-only returned ${byDate.length}, full-ISO returned ${byDatetime.length}`);
console.log('>>> equal AND today has calls  => the time component is IGNORED,');
console.log('>>> so the timeline service must filter exactly in memory.');

// ── 3. Messages ─────────────────────────────────────────────────────────────
const messages = summarise(
  'Messages (unfiltered)',
  await call('Messages unfiltered', '/Messages', { PageSize: '5' }),
  'messages',
);
if (messages.length > 0) {
  console.log(`\n>>> MESSAGE SIDS: ${messages.map((m) => m.sid).join(' | ')}`);
  console.log(`>>> directions: ${uniq(messages.map((m) => m.direction))}`);
  console.log(`>>> statuses:   ${uniq(messages.map((m) => m.status))}`);
  console.log(`>>> date_sent sample: ${JSON.stringify(messages[0].date_sent)}`);
  const withMedia = messages.find((m) => Number(m.num_media) > 0);
  if (withMedia) {
    summarise(
      'Media list',
      await call('Media', `/Messages/${withMedia.sid}/Media`, { PageSize: '5' }),
      'media_list',
    );
  } else {
    console.log('>>> no MMS in the sample — media_list shape NOT verified');
  }
}

// ── 4. Recordings ───────────────────────────────────────────────────────────
const recordings = summarise(
  'Recordings (unfiltered)',
  await call('Recordings unfiltered', '/Recordings', { PageSize: '5' }),
  'recordings',
);

if (recordings.length > 0) {
  const r = recordings[0];
  console.log(`\n>>> RECORDING SID: ${r.sid}  call_sid=${r.call_sid}`);
  for (const [label, withAuth] of [
    ['with auth', true],
    ['NO auth  ', false],
  ]) {
    const url = `${BASE}/Recordings/${r.sid}.mp3`;
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: withAuth ? { Authorization: AUTH } : {},
        signal: AbortSignal.timeout(20000),
      });
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(
        `    mp3 ${label}: ${res.status} ${Date.now() - t0}ms ` +
          `ct=${res.headers.get('content-type')} bytes=${buf.length} ` +
          `accept-ranges=${res.headers.get('accept-ranges') ?? '-'}`,
      );
    } catch (err) {
      console.log(`    mp3 ${label}: ${err.name}: ${err.message}`);
    }
  }
} else {
  console.log('\n>>> NO RECORDINGS on the account yet — expected until <Dial record=…> ships.');
}

console.log('\ndone.');
