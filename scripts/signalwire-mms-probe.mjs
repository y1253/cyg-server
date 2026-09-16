#!/usr/bin/env node
/**
 * Probe the three MMS behaviours the picture/audio text feature depends on and cannot
 * assume from the docs.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * CLAUDE.md already records five things the SignalWire docs get wrong, one of which cost
 * 31 purchased numbers. Three more are load-bearing here, and every one of them fails
 * SILENTLY if the assumption is wrong:
 *
 *   1. MEDIA LIST — that `GET /Messages/{sid}/Media` keys its list on `media_list`, not
 *      `media`. `parseMessageMedia` returns [] for an unrecognised key, so an inbound MMS
 *      would render as "no attachments" with nothing in the logs.
 *
 *   2. MEDIA BYTES — whether `/Messages/{sid}/Media/{mediaSid}` returns the bytes or a 3xx
 *      to a CDN host. This decides whether the proxy route is one hop or two, and it
 *      matters more than it looks: undici strips the Authorization header across an
 *      origin-crossing redirect, so following it blindly either 401s or leaks the
 *      credential to whatever host the redirect names. `fetchMessageMedia` handles the
 *      redirect manually on the assumption that the target is public — this confirms it.
 *
 *   3. MediaUrl ON SEND — that the LaML `/Messages` endpoint accepts `MediaUrl` at all,
 *      and that a repeated key sends several attachments. The API is a Twilio clone so
 *      this is very likely, but "very likely" is what the capability-casing bug was too.
 *
 * It also re-checks the number's own `mms` capability, because only the GET path reports
 * capabilities truthfully — the PURCHASE response returns a constant that lies (CLAUDE.md
 * point 5).
 *
 * ⚠️ MUST RUN ON THE HETZNER HOST. SignalWire is unreachable from the office network —
 * Node fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE because the "Geder Filter"
 * TLS-intercepting proxy re-signs certificates and Node does not trust its CA.
 *
 *   ssh root@87.99.134.152
 *   cd cyg-server && node scripts/signalwire-mms-probe.mjs
 *
 * READ-ONLY BY DEFAULT — it only inspects messages that already exist, and costs nothing.
 * Sending is opt-in because it COSTS ONE MMS and delivers a real message to a real phone:
 *
 *   node scripts/signalwire-mms-probe.mjs --send --to=+15145551234 --from=+14382561210 \
 *     --media-url=https://<host>/api/signature-images/public/<publicId>
 *
 * Using the firm's own signature-logo route as the `MediaUrl` is the cheapest way to test
 * it: already public, unauthenticated and stable, so nothing new has to be deployed first.
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
    /* env may already be in the environment */
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

const BASE = `https://${SPACE}/api/laml/2010-04-01/Accounts/${PROJECT}`;
const AUTH = `Basic ${Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64')}`;

async function call(method, pathname, form) {
  const url = `${BASE}${pathname}`;
  const init = {
    method,
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = form.toString();
  }
  const started = Date.now();
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  console.log(
    `  ${method} ${pathname} -> ${res.status} (${Date.now() - started}ms)`,
  );
  return { ok: res.ok, status: res.status, body };
}

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name) => process.argv.includes(`--${name}`);

const findings = [];
const record = (question, answer) => {
  findings.push({ question, answer });
  console.log(`  => ${question}: ${answer}`);
};

// ── 1. Find a message that has media ─────────────────────────────────────────
async function findMmsSid() {
  console.log('\n── 1. An inbound MMS to inspect ──────────────────────────────');
  const explicit = arg('sid');
  if (explicit) {
    console.log(`  Using --sid=${explicit}`);
    return explicit;
  }
  const { body } = await call('GET', '/Messages?PageSize=200');
  const list = body?.messages ?? [];
  const withMedia = list.filter((m) => Number(m.num_media ?? 0) > 0);
  console.log(
    `  ${list.length} message(s) on the account, ${withMedia.length} with media.`,
  );
  if (!withMedia.length) {
    console.log('  Send a picture TO the support number from a mobile, then re-run.');
    console.log('  (Or pass one with --sid=<messageSid>.)');
    return null;
  }
  const picked = withMedia[0];
  console.log(
    `  Picked ${picked.sid} (num_media=${picked.num_media}, from=${picked.from})`,
  );
  return picked.sid;
}

// ── 2. The media LIST: which key, which fields ───────────────────────────────
async function inspectMediaList(sid) {
  console.log('\n── 2. GET /Messages/{sid}/Media ──────────────────────────────');
  const { ok, body } = await call('GET', `/Messages/${sid}/Media`);
  if (!ok) {
    record('media list', 'FAILED — the endpoint answered an error');
    return null;
  }
  console.log('  Raw response (first 40 lines):');
  console.log(JSON.stringify(body, null, 2).split('\n').slice(0, 40).join('\n'));

  const keys = Object.keys(body ?? {});
  const listKey = keys.find((k) => Array.isArray(body[k]));
  record(
    'list key',
    listKey === 'media_list'
      ? 'media_list — as parseMessageMedia assumes OK'
      : `${listKey ?? 'NONE'} — WRONG: parseMessageMedia reads media_list and returns []`,
  );

  const first = listKey ? body[listKey][0] : null;
  if (first) {
    console.log(`  Fields on the first item: ${Object.keys(first).join(', ')}`);
    record(
      'item fields',
      `sid=${first.sid ? 'present' : 'MISSING'}, content_type=${first.content_type ?? 'MISSING'}`,
    );
    if (typeof first.uri === 'string') {
      record(
        'uri shape',
        first.uri.startsWith('/api/laml')
          ? 'a PATH under /api/laml — cannot be appended to the account-scoped base (the next_page_uri trap)'
          : first.uri.slice(0, 60),
      );
    }
  }
  return first?.sid ?? null;
}

// ── 3. The media BYTES: redirect or not ──────────────────────────────────────
async function inspectMediaBytes(sid, mediaSid) {
  console.log('\n── 3. GET /Messages/{sid}/Media/{mediaSid} ───────────────────');
  const url = `${BASE}/Messages/${sid}/Media/${mediaSid}`;
  const res = await fetch(url, {
    headers: { Authorization: AUTH },
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  const location = res.headers.get('location');
  console.log(
    `  status=${res.status} content-type=${res.headers.get('content-type')}`,
  );
  console.log(
    `  content-length=${res.headers.get('content-length')} location=${location ?? 'none'}`,
  );

  if (res.status >= 300 && res.status < 400 && location) {
    const sameOrigin = new URL(location).host === new URL(BASE).host;
    record(
      'bytes',
      `REDIRECT to ${new URL(location).host} (${sameOrigin ? 'same origin' : 'CROSS-ORIGIN'}) — ` +
        'fetchMessageMedia follows it manually, which is correct',
    );
    // Does the target need auth? This decides whether the second hop must carry the
    // header — it must not, if the target is public, and undici would strip it anyway.
    const anon = await fetch(location, { signal: AbortSignal.timeout(20_000) });
    record(
      'redirect target',
      anon.ok
        ? `PUBLIC (${anon.status}) — the second hop is correctly made without auth OK`
        : `needs auth (${anon.status}) — WRONG: fetchMessageMedia's second hop sends none`,
    );
  } else if (res.ok) {
    record(
      'bytes',
      `served DIRECTLY (${res.status}) — the manual-redirect branch is simply unused OK`,
    );
  } else {
    record('bytes', `FAILED ${res.status}`);
  }
}

// ── 4. Does the number report MMS capability? ────────────────────────────────
async function inspectCapability() {
  console.log('\n── 4. Owned-number MMS capability ────────────────────────────');
  const { body } = await call('GET', '/IncomingPhoneNumbers?PageSize=50');
  const list = body?.incoming_phone_numbers ?? [];
  if (!list.length) {
    record('mms capability', 'no owned numbers to check');
    return;
  }
  // Only the GET path is trustworthy — the purchase response returns a constant that lies.
  for (const n of list.slice(0, 10)) {
    const caps = n.capabilities ?? {};
    console.log(
      `  ${n.phone_number}  mms=${String(caps.mms ?? caps.MMS)}  sms=${String(caps.sms ?? caps.SMS)}`,
    );
  }
  const anyMms = list.some(
    (n) => (n.capabilities?.mms ?? n.capabilities?.MMS) === true,
  );
  record(
    'mms capability',
    anyMms
      ? 'at least one owned number reports mms:true OK'
      : 'NO owned number reports mms:true — picture messages cannot be sent',
  );
}

// ── 5. Does MediaUrl work on send? (opt-in — costs one MMS) ──────────────────
async function trySend() {
  console.log('\n── 5. POST /Messages with MediaUrl ───────────────────────────');
  const to = arg('to');
  const from = arg('from');
  const mediaUrl = arg('media-url');
  if (!to || !from) {
    console.log('  Needs --to=+1... and --from=<a support number you own>. Skipped.');
    return;
  }
  if (!mediaUrl || !mediaUrl.startsWith('http')) {
    console.log('  Needs --media-url=<a PUBLIC https url to any image>. Skipped.');
    console.log('  Tip: the firm signature logo route is already public and stable.');
    return;
  }

  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', from);
  form.set('Body', 'MMS probe — please ignore.');
  // Appended, not set: this is the repeated-key form the send path uses for several
  // attachments, so the probe exercises the same shape.
  form.append('MediaUrl', mediaUrl);

  const { ok, body } = await call('POST', '/Messages', form);
  if (!ok) {
    record('MediaUrl on send', `REJECTED — ${JSON.stringify(body).slice(0, 300)}`);
    return;
  }
  console.log(
    `  sid=${body?.sid} status=${body?.status} num_media=${body?.num_media}`,
  );
  record(
    'MediaUrl on send',
    'ACCEPTED — re-GET the message in a minute; num_media should be 1 and status delivered',
  );
  console.log(
    `  Follow up with:  node scripts/signalwire-mms-probe.mjs --sid=${body?.sid}`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log('SignalWire MMS probe');
  console.log(`  space=${SPACE} project=${PROJECT.slice(0, 8)}…`);

  const sid = await findMmsSid();
  if (sid) {
    const mediaSid = await inspectMediaList(sid);
    if (mediaSid) await inspectMediaBytes(sid, mediaSid);
  }
  await inspectCapability();
  if (flag('send')) await trySend();
  else {
    console.log(
      '\n(Pass --send --to=… --from=… --media-url=… to test sending. Costs one MMS.)',
    );
  }

  console.log('\n── Verdict ───────────────────────────────────────────────────');
  if (!findings.length) console.log('  Nothing could be checked — see the notes above.');
  for (const f of findings) console.log(`  ${f.question}: ${f.answer}`);
})().catch((err) => {
  console.error('\nProbe failed:', err);
  if (String(err).includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
    console.error('\n⚠️ This is the office TLS proxy. Run this on the Hetzner host.');
  }
  process.exit(1);
});
