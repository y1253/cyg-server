#!/usr/bin/env node
/**
 * Discover what SignalWire Call Fabric can actually do on THIS account, before any
 * internal-calling code is written against it.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────
 * Internal staff calling wants three things: address a specific person (not a shared
 * credential), record the call on SignalWire, and play the recording back like a normal
 * call. Fabric addressing (`client.dial('/private/jack')`) would solve the first cleanly —
 * every awkward part of the sip.js alternative exists only to work around one credential
 * shared by every browser.
 *
 * The open question is RECORDING. Reading the installed SDK types
 * (`@signalwire/js@4.0.0-rc.2`) turns up no recording option on `DialOptions` at all, and
 * the only `recording: boolean` in the whole surface hangs off `RoomSession` — a ROOM, not
 * a peer-to-peer call. If that reading is right, a recorded internal call is two people in
 * a private room, not a direct dial, and that is a different design.
 *
 * This script answers that from the REST side. It cannot place a call (that needs a
 * browser), so it ends by printing exactly what to try by hand and what to look for.
 *
 * ── HOUSE RULES, borrowed from signalwire-sip-probe.mjs ───────────────────────
 *  - Print raw status and raw body. Never res.json(). The point is to DISCOVER the
 *    schema, not to assume one and have the assumption silently confirmed.
 *  - Disposable names (`cyg_probe_*`), never the `cyg_u{id}` namespace real users would use.
 *  - Create then delete. `--keep` skips the cleanup when you want to poke at the result.
 *  - Watch the DELETE-key trap: the SIP-endpoint create response nested two uuids and
 *    passing the inner one returned 404 while silently leaking the resource. Assume the
 *    same shape here until proven otherwise.
 *
 * ⚠️ MUST RUN ON HETZNER. SignalWire is unreachable from the office network — Node fails
 * with UNABLE_TO_VERIFY_LEAF_SIGNATURE because the TLS-intercepting proxy re-signs
 * certificates and Node does not trust its CA.
 *
 *   ssh root@87.99.134.152
 *   cd cyg-server && node scripts/fabric-probe.mjs
 *
 *   --keep        leave anything it created in place
 *   --verbose     print full bodies rather than the first 1200 chars
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── env ──────────────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const raw = readFileSync(path.join(process.cwd(), '.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* may already be in the environment */
  }
}
loadEnv();

const PROJECT = process.env.SIGNALWIRE_PROJECT_ID;
const TOKEN = process.env.SIGNALWIRE_API_TOKEN;
const SPACE = (process.env.SIGNALWIRE_SPACE_URL ?? '')
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');

if (!PROJECT || !TOKEN || !SPACE) {
  console.error(
    'Missing SIGNALWIRE_PROJECT_ID / SIGNALWIRE_API_TOKEN / SIGNALWIRE_SPACE_URL',
  );
  process.exit(1);
}

const KEEP = process.argv.includes('--keep');
const VERBOSE = process.argv.includes('--verbose');
const AUTH = `Basic ${Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64')}`;
const STAMP = Date.now().toString(36);

/** Everything created, so cleanup can run even after a later step throws. */
const created = [];

/** Requests that never reached SignalWire. Any of these invalidate every verdict. */
let netFailures = 0;

/**
 * One request. Prints status + raw body; returns both plus a best-effort parse.
 * Deliberately never throws on a non-2xx — a 404 is data here, not a failure.
 */
async function call(method, pathname, body, label = '') {
  const url = `https://${SPACE}${pathname}`;
  const init = {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const started = Date.now();
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    netFailures += 1;
    const message = String(err?.message ?? err);
    console.log(`  ${method} ${pathname} -> NETWORK FAIL (${message})`);
    // A network failure is NOT an answer. Saying "Fabric is not enabled" because the
    // request never left the machine would be worse than saying nothing.
    if (message.includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
      console.log('    ^ the office TLS proxy re-signs certs and Node distrusts its CA.');
      console.log('      Run this on Hetzner. Nothing here can be concluded.');
      process.exit(1);
    }
    return { ok: false, status: 0, raw: '', json: null, netFail: true };
  }

  const raw = await res.text();
  const ms = Date.now() - started;
  console.log(`  ${method} ${pathname} -> ${res.status} (${ms}ms) ${label}`);
  if (raw) {
    const shown = VERBOSE || raw.length <= 1200 ? raw : `${raw.slice(0, 1200)}… [+${raw.length - 1200} chars]`;
    console.log(`    ${shown.replace(/\n/g, '\n    ')}`);
  }

  let json = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    /* not JSON — the raw print above is the record */
  }
  return { ok: res.ok, status: res.status, raw, json };
}

function heading(text) {
  console.log(`\n${'─'.repeat(78)}\n${text}\n${'─'.repeat(78)}`);
}

function verdict(text) {
  console.log(`\n  >> ${text}`);
}

// ── A. Which Fabric endpoints exist at all ───────────────────────────────────
async function discover() {
  heading('A. Which Fabric endpoints answer on this account');

  const candidates = [
    '/api/fabric/resources',
    '/api/fabric/resources/subscribers',
    '/api/fabric/resources/sip_endpoints',
    '/api/fabric/resources/rooms',
    '/api/fabric/addresses',
    '/api/fabric/subscribers',
    // The Compat API, for comparison — this one is known to work.
    `/api/laml/2010-04-01/Accounts/${PROJECT}/Calls?PageSize=1`,
  ];

  const alive = [];
  for (const p of candidates) {
    const r = await call('GET', p);
    if (r.status >= 200 && r.status < 300) alive.push(p);
  }
  // The Compat call is the CONTROL. It is known to work on Hetzner, so if it did not
  // even reach the network, nothing below distinguishes "Fabric is off" from "this
  // machine cannot talk to SignalWire" — and those lead to opposite decisions.
  if (netFailures > 0) {
    console.log(
      '\n  !! ' + netFailures + ' request(s) never reached SignalWire.\n' +
        '     This probe cannot conclude ANYTHING about Fabric from here.\n' +
        '     Run it on Hetzner (ssh root@87.99.134.152, cd cyg-server).',
    );
    process.exit(1);
  }

  verdict(
    alive.length
      ? `Reachable: ${alive.join(', ')}`
      : 'Every endpoint answered, and NONE of the /api/fabric ones returned 2xx. Read the ' +
        'status codes above: 401/403 means credentials or plan, 404 means the endpoint ' +
        'does not exist on this space. Either way Fabric addressing is unavailable ' +
        'without account changes, and the sip.js plan stands.',
  );
  return alive;
}

// ── B. Can a subscriber be created WITHOUT the dashboard? ────────────────────
async function subscriberLifecycle() {
  heading('B. Subscriber lifecycle via API (the whole point — no dashboard step)');

  const name = `cyg_probe_${STAMP}`;
  // Shapes are guesses on purpose: whichever is accepted tells us the real one.
  const attempts = [
    ['/api/fabric/resources/subscribers', { name, display_name: 'Cyg Probe' }],
    ['/api/fabric/subscribers', { reference: name, display_name: 'Cyg Probe' }],
    [
      '/api/fabric/resources/subscribers',
      { reference: name, first_name: 'Cyg', last_name: 'Probe' },
    ],
  ];

  for (const [pathname, body] of attempts) {
    const r = await call('POST', pathname, body, '(create attempt)');
    if (r.ok && r.json) {
      // The SIP-endpoint probe found TWO uuids nested, and the INNER one 404s on
      // delete while leaking the resource. Print both so the delete key is unambiguous.
      const outer = r.json.id;
      const inner =
        r.json.subscriber?.id ?? r.json.sip_endpoint?.id ?? r.json.data?.id ?? null;
      console.log(`    OUTER id = ${outer}`);
      console.log(`    INNER id = ${inner ?? '(none nested)'}  <- do NOT delete by this`);
      created.push({ pathname, id: outer });
      verdict(`Subscriber creation WORKS via ${pathname}. No dashboard step needed.`);
      return { name, resource: r.json, pathname };
    }
  }

  verdict(
    'Could not create a subscriber through any guessed shape. Read the 4xx bodies above — ' +
      'if it is a permissions/plan error, Fabric addressing is off the table without ' +
      'account changes, and the sip.js plan stands.',
  );
  return null;
}

// ── C. Addresses — what does /private/jack actually look like? ───────────────
async function addresses(subscriber) {
  heading('C. Address format (is it really /private/{name}?)');

  await call('GET', '/api/fabric/addresses?page_size=20');
  if (subscriber?.resource?.id) {
    await call('GET', `/api/fabric/resources/${subscriber.resource.id}/addresses`);
  }
  verdict(
    'Look for the "name"/"channel"/"type" fields above. The SIP-endpoint probe saw ' +
      '/public/{username}; confirm whether a subscriber gets /private/{name}, whether we ' +
      'can CHOOSE the name (so it can be u{userId}), and whether /private is reachable ' +
      'only by authenticated subscribers of this project.',
  );
}

// ── D. RECORDING — the question that decides the architecture ────────────────
async function recording() {
  heading('D. RECORDING — this is the one that decides the design');

  console.log(
    '  From the installed SDK types (@signalwire/js@4.0.0-rc.2):\n' +
      '    - DialOptions has NO recording option (checked every field).\n' +
      '    - The only `recording: boolean` in the surface is on RoomSession.\n' +
      '  So recording looks like a ROOM feature, not a peer-to-peer call feature.\n',
  );

  // Does a room resource exist, and does it expose recording settings?
  await call('GET', '/api/fabric/resources/rooms?page_size=5');

  const roomName = `cyg_probe_room_${STAMP}`;
  const r = await call(
    'POST',
    '/api/fabric/resources/rooms',
    { name: roomName, display_name: 'Cyg Probe Room' },
    '(create room)',
  );
  if (r.ok && r.json?.id) {
    created.push({ pathname: '/api/fabric/resources/rooms', id: r.json.id });
    console.log(`    room OUTER id = ${r.json.id}`);
    // Whatever field controls recording will show up in the full resource.
    await call('GET', `/api/fabric/resources/${r.json.id}`, undefined, '(full room resource)');
  }

  verdict(
    'Decide from the bodies above:\n' +
      '     (a) If a room can be created with recording enabled -> an internal call is two\n' +
      '         people joining a private room. Workable, and recording is first-class.\n' +
      '     (b) If recording only exists for rooms and rooms are heavyweight/video-oriented\n' +
      '         -> weigh that against the sip.js plan, which already records today.\n' +
      '     (c) If nothing here records audio at all -> STOP. The sip.js plan stands, and\n' +
      '         this is the reason. Write it into CLAUDE.md.',
  );
}

// ── E. Does any of it reach the Compat API we already know? ──────────────────
async function compatVisibility() {
  heading('E. Do Fabric calls/recordings appear in the Compat API?');

  await call(
    'GET',
    `/api/laml/2010-04-01/Accounts/${PROJECT}/Recordings?PageSize=5`,
    undefined,
    '(existing recordings, for shape comparison)',
  );

  verdict(
    'This matters twice over:\n' +
      '     1. Playback reuse — fetchRecordingMedia() and the token-bound /recordings/:sid\n' +
      '        proxy only work if Fabric recordings land in /Recordings like these do.\n' +
      '     2. Timeline safety — if Fabric calls DO appear in Calls, confirm they cannot\n' +
      '        match any Calls?To=/From={support number} query, or internal staff calls\n' +
      '        would surface in a client company feed.\n' +
      '     Re-run this AFTER placing a real browser call (step F) and diff the list.',
  );
}

// ── F. What a browser has to prove, which this script cannot ─────────────────
function browserInstructions(subscriber) {
  heading('F. The browser half — do this by hand, it cannot be scripted here');

  const addr = subscriber ? `/private/${subscriber.name}` : '/private/{subscriber}';
  console.log(`
  1. Mint a subscriber token server-side (section C should have shown the endpoint) and
     confirm its TTL. That short-lived token is the entire security argument for Fabric
     over the shared SIP password every browser holds today.

  2. In a browser console on the app origin:

       import { SignalWire } from '@signalwire/js';
       const client = new SignalWire(/* credential provider with the token */);
       const call = await client.dial('${addr}');

     Confirm: does the far side ring, and ONLY the far side? (The whole point.)

  3. With a second browser signed in as the other user, answer, and check:
       - two-way audio
       - the call appears in the Compat Calls list (re-run section E)
       - A RECORDING EXISTS and is fetchable at /Recordings/{sid}.mp3

  4. If recording needs a room rather than a direct dial, repeat with both parties
     dialling the same room address and recording enabled, and note how much worse the
     UX is (join latency, whether it still feels like a phone call).

  Record every answer in CLAUDE.md beside the "six things verified against the live
  account" table — including the ones that match the docs.`);
}

// ── cleanup ──────────────────────────────────────────────────────────────────
async function cleanup() {
  if (!created.length) return;
  heading('Cleanup');
  if (KEEP) {
    console.log('  --keep given; leaving these in place:');
    for (const c of created) console.log(`    ${c.pathname}/${c.id}`);
    return;
  }
  for (const c of created) {
    // Delete by the OUTER id — the inner one 404s and leaks the resource.
    await call('DELETE', `${c.pathname}/${c.id}`, undefined, '(cleanup, OUTER id)');
  }
  console.log('\n  Verify in the dashboard that nothing was leaked.');
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`SignalWire Call Fabric probe — space ${SPACE}, project ${PROJECT.slice(0, 8)}…`);
  console.log(`Created resources are named cyg_probe_*${STAMP}\n`);

  try {
    await discover();
    const subscriber = await subscriberLifecycle();
    await addresses(subscriber);
    await recording();
    await compatVisibility();
    browserInstructions(subscriber);
  } catch (err) {
    console.error('\nProbe aborted:', err?.message ?? err);
  } finally {
    await cleanup();
  }

  heading('The decision this probe exists to make');
  console.log(`
  Fabric wins ONLY if a staff-to-staff call can be recorded and the recording retrieved
  the way client-call recordings already are. Everything else about Fabric is better —
  real per-user addressing with no dashboard step, short-lived tokens instead of a shared
  SIP password in every browser, and no forked INVITEs to disambiguate.

  If recording does not work cleanly, the sip.js plan in the plan file stands. It records
  today, proven, and its cost is a marker header plus one table.`);
})();
