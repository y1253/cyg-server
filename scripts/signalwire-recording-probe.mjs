#!/usr/bin/env node
/**
 * Probe the two SignalWire behaviours this feature depends on and cannot assume.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * CLAUDE.md records five things the SignalWire docs get wrong, one of which cost 31
 * purchased numbers. Two more assumptions are load-bearing here:
 *
 *   1. HOLD  — that an in-progress recording can be paused and resumed, and that
 *              PauseBehavior=skip actually REMOVES the paused span rather than filling
 *              it with silence. If it cannot, hold still works but the hold music ends
 *              up in the recording, which is exactly what we promised it would not do.
 *
 *   2. VOICEMAIL — that a <Record> recording shows up in /Recordings against the inbound
 *              parent leg, and whether the resource carries a `source` field
 *              distinguishing RecordVerb from DialVerb. Without `source`, voicemails are
 *              identified by "the call was never answered but has a recording", which is
 *              what the timeline does today.
 *
 *   3. WINDOWING — that /Recordings honours a `DateCreated<` filter, the way /Calls
 *              honours `StartTime<`. The timeline asks for recordings ACCOUNT-WIDE, one
 *              page, no pagination: past one page of recordings the older rows in a
 *              window silently lose their badge while the detail view still plays the
 *              audio, and nothing detects the disagreement. If the filter is ignored the
 *              code is no worse than before; if it ERRORS, the catch turns every row into
 *              "no recording". That is the difference this question settles.
 *
 * ⚠️ MUST RUN ON THE HETZNER HOST. SignalWire is unreachable from the office network —
 * Node fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE because the "Geder Filter"
 * TLS-intercepting proxy re-signs certificates and Node does not trust its CA.
 *
 *   ssh root@87.99.134.152
 *   cd cyg-server && node scripts/signalwire-recording-probe.mjs
 *
 * READ-ONLY BY DEFAULT: with no arguments it only inspects recordings that already
 * exist. Pausing a live recording needs a call in progress, so that part is opt-in:
 *
 *   node scripts/signalwire-recording-probe.mjs --call-sid=<sid of a LIVE call>
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
    signal: AbortSignal.timeout(15_000),
  };
  if (form) {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(form).toString();
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
  console.log(`  ${method} ${pathname} -> ${res.status} (${Date.now() - started}ms)`);
  return { ok: res.ok, status: res.status, body };
}

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

// ── 1. What a Recording resource actually looks like ─────────────────────────
async function inspectRecordings() {
  console.log('\n── 1. Recording resource shape ───────────────────────────────');
  const { body } = await call('GET', '/Recordings?PageSize=20');
  const list = body?.recordings ?? [];
  if (!list.length) {
    console.log('  No recordings on the account yet — make a recorded call first.');
    return;
  }
  console.log(`  ${list.length} recording(s). Keys on the first:`);
  console.log('   ', Object.keys(list[0]).join(', '));

  // THE question for voicemail: is there a `source` field, and what values appear?
  const sources = new Set(list.map((r) => r.source ?? '(absent)'));
  console.log(`  source values seen: ${[...sources].join(', ')}`);
  console.log(
    sources.has('(absent)')
      ? '  => No `source`. Voicemails must be identified by "unanswered call that has a\n' +
          '     recording", which is what phone-timeline.util.ts does.'
      : '  => `source` IS reported. Prefer it as the discriminator (RecordVerb vs DialVerb),\n' +
          '     keeping the unanswered rule as a fallback.',
  );

  for (const r of list.slice(0, 5)) {
    console.log(
      `    sid=${r.sid} call_sid=${r.call_sid} status=${r.status} ` +
        `dur=${r.duration} source=${r.source ?? '-'}`,
    );
  }
}

// ── 3. Does /Recordings honour a date filter? ────────────────────────────────
/**
 * Three requests, compared against each other rather than against the docs.
 *
 * A filter that is silently IGNORED and one that WORKS are indistinguishable from a
 * single call — both return 200 with rows. The unfiltered count is the control, and a
 * far-past bound is the discriminator: it must return fewer rows (ideally zero) if the
 * parameter is real.
 *
 * Bare-date vs full-ISO is asked for the same reason CLAUDE.md records it for /Calls: the
 * docs describe these params as YYYY-MM-DD, and truncating silently discards the whole
 * cursor day.
 */
async function probeDateFilter() {
  console.log('\n── 3. /Recordings date filter ────────────────────────────────');

  const all = await call('GET', '/Recordings?PageSize=1000');
  const total = all.body?.recordings?.length ?? 0;
  console.log(`  unfiltered (PageSize=1000): ${total} row(s)`);
  console.log(
    `  next_page_uri: ${all.body?.next_page_uri ?? '(null — this is the whole account)'}`,
  );
  if (total >= 1000) {
    console.log(
      '  ⚠️ Hit the page ceiling. The account has MORE than this, so the timeline is\n' +
        '     already dropping recording badges for older rows.',
    );
  }

  const past = new Date(Date.now() - 365 * 24 * 3600_000).toISOString();
  const iso = await call(
    'GET',
    `/Recordings?PageSize=1000&${encodeURIComponent('DateCreated<')}=${encodeURIComponent(past)}`,
  );
  const isoCount = iso.body?.recordings?.length ?? 0;
  console.log(`  DateCreated<${past} -> ${iso.status}, ${isoCount} row(s)`);

  const bare = await call(
    'GET',
    `/Recordings?PageSize=1000&${encodeURIComponent('DateCreated<')}=${past.slice(0, 10)}`,
  );
  console.log(
    `  DateCreated<${past.slice(0, 10)} (bare date) -> ${bare.status}, ` +
      `${bare.body?.recordings?.length ?? 0} row(s)`,
  );

  console.log('\n  VERDICT:');
  if (!iso.status || iso.status >= 400) {
    console.log(
      '    ✗ ERRORS. This is the bad case: phone-timeline.service.ts catches the\n' +
        '      failure, so EVERY row would report "no recording". Revert the `before`\n' +
        '      argument on the account-wide listRecordings() call.',
    );
  } else if (total > 0 && isoCount === total) {
    console.log(
      '    ~ IGNORED (same count as unfiltered). Harmless — the code behaves exactly as\n' +
        '      it did before — but the windowing problem is NOT fixed. Pagination or a\n' +
        '      per-call lookup is then the only real answer.',
    );
  } else {
    console.log(
      '    ✓ HONOURED. The account-wide fetch is now bounded to the window it is for.',
    );
  }
}

// ── 2. Pause / resume on a LIVE call ─────────────────────────────────────────
async function probePause(callSid) {
  console.log('\n── 2. Pause / resume an in-progress recording ────────────────');

  const { body } = await call('GET', `/Recordings?CallSid=${encodeURIComponent(callSid)}`);
  const list = body?.recordings ?? [];
  console.log(`  ${list.length} recording(s) for that call.`);
  const live = list.find((r) => r.status === 'in-progress' || r.status === 'paused');

  if (!live) {
    console.log(
      '  => No IN-PROGRESS recording listed mid-call. That is itself the answer:\n' +
        '     the sid cannot be discovered this way and must be captured from a\n' +
        '     recordingStatusCallback instead. Statuses seen: ' +
        [...new Set(list.map((r) => r.status))].join(', '),
    );
    return;
  }

  console.log(`  Pausing ${live.sid} with PauseBehavior=skip …`);
  const paused = await call(
    'POST',
    `/Calls/${encodeURIComponent(callSid)}/Recordings/${encodeURIComponent(live.sid)}`,
    { Status: 'paused', PauseBehavior: 'skip' },
  );
  console.log(
    paused.ok
      ? `  => PAUSE ACCEPTED. status=${paused.body?.status}`
      : `  => PAUSE REJECTED: ${JSON.stringify(paused.body)}`,
  );
  if (!paused.ok) return;

  console.log('  Waiting 8s so the skipped span is measurable …');
  await new Promise((r) => setTimeout(r, 8000));

  const resumed = await call(
    'POST',
    `/Calls/${encodeURIComponent(callSid)}/Recordings/${encodeURIComponent(live.sid)}`,
    { Status: 'in-progress' },
  );
  console.log(
    resumed.ok
      ? `  => RESUME ACCEPTED. status=${resumed.body?.status}`
      : `  => RESUME REJECTED: ${JSON.stringify(resumed.body)}`,
  );

  console.log(
    '\n  FINAL CHECK, once the call has ended: fetch this recording and compare its\n' +
      '  duration against the call duration. It should be about 8 SECONDS SHORTER.\n' +
      '  If it is the same length, PauseBehavior=skip inserted silence instead of\n' +
      `  removing the span. Recording sid: ${live.sid}`,
  );
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`SignalWire recording probe — space ${SPACE}`);
  try {
    await inspectRecordings();
    const callSid = arg('call-sid');
    if (callSid) {
      await probePause(callSid);
    } else {
      console.log(
        '\n── 2. Pause / resume ─────────────────────────────────────────',
      );
      console.log(
        '  SKIPPED. Needs a call that is live RIGHT NOW:\n' +
          '    node scripts/signalwire-recording-probe.mjs --call-sid=<sid>',
      );
    }
    await probeDateFilter();
  } catch (err) {
    console.error('\nProbe failed:', err?.message ?? err);
    if (String(err?.message ?? '').includes('UNABLE_TO_VERIFY_LEAF_SIGNATURE')) {
      console.error(
        'That is the office TLS proxy. Run this on the Hetzner host instead.',
      );
    }
    process.exit(1);
  }
})();
