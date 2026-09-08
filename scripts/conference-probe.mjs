#!/usr/bin/env node
/**
 * Probe everything the transfer / add-call / swap / merge feature assumes about
 * SignalWire and cannot verify any other way.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * CLAUDE.md records five things the SignalWire docs get wrong, one of which cost 31
 * purchased numbers. The multi-party design rests on Twilio-parity assumptions this
 * account has contradicted before, and two of them GATE THE WHOLE DESIGN:
 *
 *   #5  POST /Calls/{sid} accepts INLINE instructions. Twilio's parameter is `Twiml`.
 *       SignalWire may alias it to `Laml`, may require `Url`, or may not support
 *       redirecting a live call at all. If it fails, every redirect has to go through
 *       a signature-verified webhook instead — which is why the room name is derived
 *       deterministically from the root sid, so that fallback needs no query string.
 *
 *   #6  A <Dial> CHILD leg can be redirected. On an INBOUND call the agent's browser
 *       is the child, so if a child cannot be redirected the agent cannot be moved
 *       into a conference and must be re-rung — the one change that would force us to
 *       touch tryPair()'s single-call guard in SoftphoneContext.
 *
 * The rest decide how much plumbing each part needs, not whether it works at all.
 *
 * ⚠️ MUST RUN ON THE HETZNER HOST. SignalWire is unreachable from the office network —
 * Node fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE because the "Geder Filter"
 * TLS-intercepting proxy re-signs certificates and Node does not trust its CA.
 *
 *   ssh root@87.99.134.152
 *   cd cyg-server && node scripts/conference-probe.mjs
 *
 * READ-ONLY BY DEFAULT: with no arguments it answers probes 1-4 and spends nothing.
 *
 * The live half NEEDS A CALL IN PROGRESS AND WILL DISRUPT IT — it moves the legs into
 * a conference, holds one, and removes another. Use a test call you placed yourself,
 * never a client's:
 *
 *   node scripts/conference-probe.mjs --call-sid=<agent leg> --peer-sid=<other leg>
 *
 * Afterwards, to settle probe #9 once that conference has ended:
 *
 *   node scripts/conference-probe.mjs --conference-sid=<sid printed by the live run>
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
  const res = await fetch(`${BASE}${pathname}`, init);
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  console.log(
    `  ${method} ${pathname.split('?')[0]} -> ${res.status} (${Date.now() - started}ms)`,
  );
  return { ok: res.ok, status: res.status, body };
}

const arg = (name) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

const short = (v) => JSON.stringify(v ?? null).slice(0, 200);

/** Everything the run concluded, replayed as one block at the end. */
const verdicts = [];
const verdict = (id, text) => {
  verdicts.push(`  ${id.padEnd(5)} ${text}`);
  console.log(`  => ${text}`);
};

const ROOM = `cyg-probe-${Date.now()}`;

const doc = (inner) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;

const conferenceDoc = (room, endOnExit) =>
  doc(
    `<Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="${endOnExit}" beep="false">${room}</Conference></Dial>`,
  );

// ── 1. Does /Conferences exist here at all, and what shape is a row? ─────────
async function probeConferencesExist() {
  console.log('\n── 1. /Conferences resource ──────────────────────────────────');
  const { ok, status, body } = await call('GET', '/Conferences?PageSize=5');
  if (!ok) {
    verdict(
      '#1',
      `/Conferences NOT AVAILABLE (${status}). The conference half of the design is dead; ` +
        'blind transfer still works, everything else needs a rethink.',
    );
    return false;
  }
  const list = body?.conferences ?? [];
  console.log(`  ${list.length} conference(s) in history.`);
  if (list.length) {
    console.log('  Keys on the first row:');
    console.log('   ', Object.keys(list[0]).join(', '));
    console.log('  Sample:', short(list[0]));
  }
  verdict('#1', '/Conferences EXISTS. Write parseConferences against those keys.');
  return true;
}

// ── 2. Is FriendlyName a real filter, or silently ignored? ──────────────────
async function probeFriendlyNameFilter() {
  console.log('\n── 2. FriendlyName filter ────────────────────────────────────');
  const all = await call('GET', '/Conferences?PageSize=50');
  const total = (all.body?.conferences ?? []).length;
  const bogus = await call(
    'GET',
    '/Conferences?FriendlyName=cyg-no-such-room-xyz&PageSize=50',
  );
  const filtered = (bogus.body?.conferences ?? []).length;
  console.log(`  unfiltered=${total} rows, bogus FriendlyName=${filtered} rows`);

  if (filtered === 0) {
    verdict(
      '#2',
      'FriendlyName IS honoured. conferenceSidFor() can look a room up directly.',
    );
  } else if (total > 0 && filtered === total) {
    verdict(
      '#2',
      'FriendlyName is IGNORED — the same trap as DateCreated<. conferenceSidFor() MUST ' +
        'read from the statusCallback cache instead of this query.',
    );
  } else {
    verdict('#2', `Inconclusive (${filtered}/${total}). Re-run once more conferences exist.`);
  }
}

// ── 3. Does ParentCallSid filter /Calls? ────────────────────────────────────
async function probeParentFilter() {
  console.log('\n── 3. /Calls?ParentCallSid= ──────────────────────────────────');
  const recent = await call('GET', '/Calls?PageSize=200');
  const calls = recent.body?.calls ?? [];
  const child = calls.find((c) => c.parent_call_sid);
  if (!child) {
    verdict(
      '#3',
      'No call in history has a parent_call_sid — cannot test. Place one click-to-call ' +
        'and re-run.',
    );
    return;
  }
  const parentSid = child.parent_call_sid;
  console.log(`  Using parent ${parentSid} (child ${child.sid})`);

  const filtered = await call(
    'GET',
    `/Calls?ParentCallSid=${encodeURIComponent(parentSid)}&PageSize=200`,
  );
  const rows = filtered.body?.calls ?? [];
  const allMatch =
    rows.length > 0 && rows.every((c) => c.parent_call_sid === parentSid);
  console.log(`  unfiltered=${calls.length} rows, ParentCallSid=${rows.length} rows`);

  if (allMatch && rows.length < calls.length) {
    verdict('#3', 'ParentCallSid IS honoured. Leg resolution is ONE cheap request.');
  } else {
    verdict(
      '#3',
      'ParentCallSid is IGNORED. legsFor() must fall back to a windowed 200-row scan ' +
        'filtered in memory — and that comment must say it does not scale.',
    );
  }
}

// ── 4. Where does a conference recording actually live? ─────────────────────
async function probeConferenceRecordings(confSid) {
  console.log('\n── 4. Conference recordings ──────────────────────────────────');

  if (confSid) {
    const byQuery = await call(
      'GET',
      `/Recordings?ConferenceSid=${encodeURIComponent(confSid)}&PageSize=5`,
    );
    const nested = await call(
      'GET',
      `/Conferences/${encodeURIComponent(confSid)}/Recordings?PageSize=5`,
    );
    const rows =
      (nested.ok ? nested.body?.recordings : null) ??
      (byQuery.ok ? byQuery.body?.recordings : null) ??
      [];

    if (rows.length) {
      console.log('  Keys:', Object.keys(rows[0]).join(', '));
      console.log('  call_sid       =', rows[0].call_sid ?? '(absent)');
      console.log('  conference_sid =', rows[0].conference_sid ?? '(absent)');
      verdict(
        '#4',
        rows[0].call_sid
          ? 'The conference recording DOES carry a call_sid — findRecordingsForCall may be ' +
              'able to match it with no new table.'
          : 'The conference recording carries NO call_sid. The CallConference mapping table ' +
              'is REQUIRED to tie it back to the inbox row.',
      );
      return;
    }
    verdict(
      '#4',
      `No recording found for conference ${confSid}. Was it recorded? If <Conference ` +
        'record="record-from-start"> produced nothing, conference recording is unavailable ' +
        'and the fallback (do-not-record + explicit UI copy) applies.',
    );
    return;
  }

  const anyRec = await call('GET', '/Recordings?PageSize=20');
  const list = anyRec.body?.recordings ?? [];
  const withConf = list.filter((r) => r.conference_sid);
  console.log(
    `  ${list.length} recording(s) on the account, ${withConf.length} carrying a conference_sid.`,
  );
  if (list.length) console.log('  Keys:', Object.keys(list[0]).join(', '));
  verdict(
    '#4',
    'SKIPPED the definitive check — needs a recorded conference. Re-run with ' +
      '--conference-sid=<sid> afterwards. This decides whether recording survives a transfer.',
  );
}

// ── 5 + 6. Redirect a live leg into a conference ────────────────────────────

/** Try Laml, then Twiml. Reports which parameter name this account accepts. */
async function redirectLeg(sid, document, label) {
  for (const param of ['Laml', 'Twiml']) {
    const res = await call('POST', `/Calls/${encodeURIComponent(sid)}`, {
      [param]: document,
    });
    if (res.ok) {
      console.log(`  ${label}: accepted via "${param}", status=${res.body?.status}`);
      return param;
    }
    console.log(`  ${label}: "${param}" rejected -> ${short(res.body)}`);
  }
  return null;
}

async function probeLiveRedirect(agentSid, peerSid) {
  console.log('\n── 5/6. Redirecting live legs into a conference ──────────────');
  console.log(`  room = ${ROOM}`);
  console.log('  ⚠️  This DISRUPTS the call. Ctrl-C now if it is not a test call.');

  const before = await call('GET', `/Calls/${encodeURIComponent(agentSid)}`);
  const parent = before.body?.parent_call_sid;
  console.log(
    `  leg before: status=${before.body?.status} direction=${before.body?.direction} ` +
      `parent=${parent ?? '(none)'}`,
  );

  const param = await redirectLeg(agentSid, conferenceDoc(ROOM, 'false'), 'agent leg');
  if (!param) {
    verdict(
      '#5',
      'POST /Calls/{sid} REJECTED both Laml and Twiml. THE DESIGN IS GATED — redirects must ' +
        'go through a Url= webhook instead. Test Url= by hand before implementing.',
    );
    return null;
  }
  verdict(
    '#5',
    `POST /Calls/{sid} accepts inline instructions as "${param}". Use exactly that name in ` +
      'SignalWireService.updateCall.',
  );
  verdict(
    '#6',
    parent
      ? 'A <Dial> CHILD leg accepted the redirect. Inbound attended transfer can move the ' +
          'agent in place, and tryPair() stays untouched.'
      : 'The leg redirected was a ROOT leg, so #6 is UNANSWERED. Re-run with a CHILD leg as ' +
          '--call-sid to settle whether an inbound agent can be moved in place.',
  );

  console.log('\n  Watch the browser now: it must NOT receive a BYE. Waiting 3s …');
  await new Promise((r) => setTimeout(r, 3000));
  const after = await call('GET', `/Calls/${encodeURIComponent(agentSid)}`);
  console.log(`  leg after: status=${after.body?.status}`);
  verdict(
    '#6b',
    after.body?.status === 'in-progress'
      ? 'The redirected leg is STILL in-progress — its SIP dialog survived the redirect.'
      : `The redirected leg is now "${after.body?.status}". If it dropped, the agent cannot be ` +
          'moved in place and has to be re-rung into the room.',
  );

  if (peerSid) {
    await redirectLeg(peerSid, conferenceDoc(ROOM, 'true'), 'peer leg');
    await new Promise((r) => setTimeout(r, 2000));
  } else {
    console.log('  No --peer-sid given; only one leg was moved.');
  }
  return ROOM;
}

// ── 7 + 8. Participant hold / remove — this IS swap, merge and complete ─────
async function probeParticipants(room) {
  console.log('\n── 7/8. Conference participants ──────────────────────────────');
  const found = await call(
    'GET',
    `/Conferences?FriendlyName=${encodeURIComponent(room)}&Status=in-progress`,
  );
  const conf = (found.body?.conferences ?? [])[0];
  if (!conf) {
    verdict(
      '#7',
      `No in-progress conference named ${room}. Either the redirect never landed, or ` +
        'FriendlyName lookup is unavailable (see #2).',
    );
    return null;
  }
  console.log(`  conference sid = ${conf.sid}`);

  const parts = await call('GET', `/Conferences/${conf.sid}/Participants`);
  const list = parts.body?.participants ?? [];
  console.log(`  ${list.length} participant(s).`);
  if (!list.length) {
    verdict('#7', 'Conference exists but reports no participants — cannot test hold.');
    return conf.sid;
  }
  console.log('  Keys:', Object.keys(list[0]).join(', '));

  const target = list[0].call_sid;
  const held = await call(
    'POST',
    `/Conferences/${conf.sid}/Participants/${encodeURIComponent(target)}`,
    { Hold: 'true' },
  );
  verdict(
    '#7',
    held.ok
      ? `Hold=true ACCEPTED (hold=${held.body?.hold}). Swap and merge are two of these calls.`
      : `Hold=true REJECTED: ${short(held.body)}`,
  );

  if (held.ok) {
    console.log('  LISTEN NOW: does the held party hear silence, or default hold music?');
    await new Promise((r) => setTimeout(r, 4000));
    await call(
      'POST',
      `/Conferences/${conf.sid}/Participants/${encodeURIComponent(target)}`,
      { Hold: 'false' },
    );
  }

  if (list.length > 1) {
    const victim = list[list.length - 1].call_sid;
    const removed = await call(
      'DELETE',
      `/Conferences/${conf.sid}/Participants/${encodeURIComponent(victim)}`,
    );
    verdict(
      '#8',
      removed.ok
        ? `DELETE participant returned ${removed.status}. NOW CHECK BY EAR: did that leg hang ` +
            'up, or fall through to its next verb? That decides whether completeTransfer can ' +
            'simply be a browser bye().'
        : `DELETE participant REJECTED: ${short(removed.body)}`,
    );
  } else {
    verdict('#8', 'Only one participant — skipped. Re-run with --peer-sid to test removal.');
  }
  return conf.sid;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`SignalWire conference probe — space ${SPACE}`);
  const agentSid = arg('call-sid');
  const peerSid = arg('peer-sid');
  const confSid = arg('conference-sid');

  try {
    const exists = await probeConferencesExist();
    await probeFriendlyNameFilter();
    await probeParentFilter();
    await probeConferenceRecordings(confSid);

    if (!exists) {
      console.log('\n/Conferences is unavailable — skipping the live probes.');
    } else if (agentSid) {
      const room = await probeLiveRedirect(agentSid, peerSid);
      if (room) {
        const sid = await probeParticipants(room);
        if (sid) {
          console.log(
            '\n  Once this conference has ended, settle probe #9 with:\n' +
              `    node scripts/conference-probe.mjs --conference-sid=${sid}`,
          );
        }
      }
    } else {
      console.log('\n── 5-8. Live probes ──────────────────────────────────────────');
      console.log(
        '  SKIPPED. They need a call that is live RIGHT NOW, and they DISRUPT it:\n' +
          '    node scripts/conference-probe.mjs --call-sid=<agent leg> --peer-sid=<other leg>\n' +
          '  #5 and #6 GATE the design — do not start implementing without them.',
      );
    }

    console.log('\n══ VERDICTS ══════════════════════════════════════════════════');
    if (!verdicts.length) console.log('  (none)');
    for (const v of verdicts) console.log(v);
    console.log('');
  } catch (err) {
    // Node wraps a transport failure as a bare "fetch failed" and hides the real reason
    // on `cause`. Without unwrapping it, the office TLS proxy looks like an outage.
    const cause = err?.cause;
    const detail = cause?.code ?? cause?.message ?? '';
    console.error('\nProbe failed:', err?.message ?? err, detail ? `(${detail})` : '');
    if (
      /UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(
        `${detail}`,
      )
    ) {
      console.error(
        'SignalWire is unreachable from here. That is the office TLS proxy — run this on\n' +
          'the Hetzner host:  ssh root@87.99.134.152 && cd cyg-server && node scripts/conference-probe.mjs',
      );
    }
    process.exit(1);
  }
})();
