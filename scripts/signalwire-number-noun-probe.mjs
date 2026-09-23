/**
 * ⚠️ ANSWERED, Sep 2026: **SignalWire honours only the FIRST noun in a `<Dial>`.**
 *
 * Verified on the live account with the three variants below, each one real inbound call:
 *
 *   <Number> alone                 -> leg created, the mobile rang        ✅
 *   <Number url=…> alone           -> leg created, the mobile rang        ✅
 *   <Sip> + <Number>  (mixed)      -> ONLY the <Sip> leg exists           ❌
 *
 * So it is not the whisper `url` and not the caller ID -- it is MIXING. That is why
 * `ringMobiles` could never work: `ringAndDial` emits the browsers' `<Sip>` first, so the
 * mobile's `<Number>` was silently discarded, with no leg, no error and nothing in any log.
 *
 * It stayed invisible for so long because every browser shares ONE SIP credential, so
 * `ringAndDial` had always emitted exactly one noun -- a multi-noun `<Dial>` had never been
 * exercised on this account. `dialSipVerb`'s docblock still claims several nouns ring
 * simultaneously; for `<Sip>` nouns that is untested, and for MIXED nouns it is false.
 *
 * The mobile-ringing feature was removed on the strength of this. Anything that wants to
 * ring a browser and a phone at once has to use `<Conference>`, not a second noun.
 *
 * ── KEPT BECAUSE THE READ-ONLY HALF IS STILL USEFUL ─────────────────────────────
 *   --recent                    recent inbound calls
 *   --tree=<sid> [--to=+1…]     a call's leg tree, and whether a <Number> produced a leg
 *   --dial --to= --from=        place ONE real call (spends money)
 *   --inbound --to=<support> --from=<owned> [--mobile=+1…]
 *                               trigger a real INBOUND call and read the tree back
 *
 * ⚠️ RUN ON THE HETZNER HOST. The office "Geder Filter" re-signs TLS and Node rejects
 * SignalWire's certificate, so every request here fails locally with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * ⚠️ `--inbound` tests whatever the server would really answer, so two things can make it
 * report a false "no leg": an after-hours call never reaches `ringAndDial` at all, and a
 * company assigned to a user with no number produces no `<Number>` to begin with. Check the
 * document first with `scripts/laml-probe.mjs --to=<support number>`. Both of those cost a
 * wasted call here before they were noticed.
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

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=');
    return [k, rest.join('=') || 'true'];
  }),
);

const host = SPACE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const BASE = `https://${host}/api/laml/2010-04-01/Accounts/${PROJECT}`;
const AUTH = 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');

async function get(path, query) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    headers: { Authorization: AUTH, Accept: 'application/json' },
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${url.pathname} -> ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

async function post(path, form) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  return { status: res.status, body: text };
}

const leg = (c) =>
  `${String(c.sid).slice(0, 8)}  ${String(c.direction ?? '-').padEnd(14)}` +
  `${String(c.status ?? '-').padEnd(12)}from=${String(c.from ?? '-').padEnd(34).slice(0, 34)} ` +
  `to=${String(c.to ?? '-').padEnd(34).slice(0, 34)} dur=${c.duration ?? '-'}`;

/** The question every stage actually asks: did a leg to this number get created? */
async function tree(parentSid, expectMobile) {
  const parent = await get(`/Calls/${parentSid}.json`);
  const kids = await get('/Calls.json', { ParentCallSid: parentSid, PageSize: 50 });
  const children = kids.calls ?? [];

  console.log('\n=== leg tree ===');
  console.log('ROOT  ' + leg(parent));
  for (const c of children) console.log('  +-  ' + leg(c));
  if (children.length === 0) console.log('  (no child legs)');

  const sip = children.filter((c) => String(c.to ?? '').startsWith('sip:'));
  const pstn = children.filter((c) => !String(c.to ?? '').startsWith('sip:'));
  console.log('\n=== verdict ===');
  console.log(`  <Sip> legs    : ${sip.length}`);
  console.log(`  <Number> legs : ${pstn.length}`);
  if (expectMobile) {
    const hit = pstn.find((c) => String(c.to) === expectMobile);
    console.log(
      hit
        ? `  ✔ the mobile WAS dialled (${String(hit.sid).slice(0, 8)}, status=${hit.status})`
        : `  ✘ NO leg to ${expectMobile} — SignalWire discarded the noun before dialling.`,
    );
  }
  if (sip.length > 0 && pstn.length === 0) {
    console.log(
      '  => The known behaviour: SignalWire honours only the FIRST noun in a <Dial>,\n' +
        '     so a <Number> after a <Sip> is discarded. See the header.',
    );
  }
}

if (args.recent) {
  const d = await get('/Calls.json', { PageSize: 40 });
  const inbound = (d.calls ?? []).filter((c) => c.direction === 'inbound');
  console.log('=== recent inbound calls (newest first) ===');
  for (const c of inbound.slice(0, 15)) {
    console.log(`${c.sid}  ${c.date_created}  from=${c.from} to=${c.to} ${c.status}`);
  }
  console.log('\nRe-run with --tree=<sid> to see whether its <Number> noun produced a leg.');
} else if (args.tree && args.tree !== 'true') {
  await tree(args.tree, args.to && args.to !== 'true' ? args.to : null);
} else if (args.inbound) {
  // ── STAGE B ────────────────────────────────────────────────────────────────────
  // A real INBOUND call to the support number, placed from another number we own, so the
  // whole thing is self-service: SignalWire dials the support number, that arrives at our
  // own `voice/inbound` webhook, and whatever `<Dial>` shape PHONE_RING_PROBE selects is
  // what gets executed. Then read the leg tree back.
  //
  // The `<Pause>` is what keeps the CALLING leg up long enough for the inbound side to
  // ring; without it the leg completes immediately and cancels the call under test.
  const to = args.to;
  const from = args.from;
  const mobile = args.mobile && args.mobile !== 'true' ? args.mobile : null;
  if (!to || !from || to === 'true' || from === 'true') {
    console.error('--inbound needs --to=<support number> --from=<another number you own>');
    process.exit(1);
  }
  console.log(`STAGE B: calling ${to} from ${from} to trigger a real inbound call.`);
  console.log('Whatever PHONE_RING_PROBE is set to on the server is what gets tested.');
  console.log('');
  const { status, body } = await post('/Calls.json', {
    To: to,
    From: from,
    Laml: '<Response><Pause length="25"/><Hangup/></Response>',
    Timeout: '20',
  });
  if (status >= 400) {
    console.log(`HTTP ${status}`);
    console.log(body.slice(0, 600));
    process.exit(1);
  }
  const outbound = JSON.parse(body).sid;
  console.log(`  calling leg = ${outbound}`);
  process.stdout.write('  waiting for the inbound call to ring and settle');
  for (let i = 0; i < 9; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    process.stdout.write('.');
  }
  console.log('');

  // Find the inbound call this produced: newest inbound leg with the same from/to.
  const recent = await get('/Calls.json', { PageSize: 50 });
  const match = (recent.calls ?? []).find(
    (c) => c.direction === 'inbound' && c.from === from && c.to === to,
  );
  if (!match) {
    console.log('  ✘ no inbound call found — did the call connect at all?');
    process.exit(1);
  }
  console.log(`  inbound leg = ${match.sid}`);
  await tree(match.sid, mobile);
} else if (args.dial) {
  // ── STAGE A ────────────────────────────────────────────────────────────────────
  // Can this account originate a PSTN call to that number at all, with the company's
  // support number as caller ID? If this fails, no amount of LaML tinkering helps and
  // Stage B is a waste of calls.
  const to = args.to;
  const from = args.from;
  if (!to || !from || to === 'true' || from === 'true') {
    console.error('--dial needs --to=+1… and --from=<a support number you own>');
    process.exit(1);
  }
  console.log(`STAGE A: POST /Calls  to=${to}  from=${from}`);
  console.log('This places ONE real call. Nobody needs to answer it.\n');
  const { status, body } = await post('/Calls.json', {
    To: to,
    From: from,
    // Short and harmless. The point is leg CREATION, not what the callee hears.
    Laml: '<Response><Say>Probe.</Say><Hangup/></Response>',
    Timeout: '20',
  });
  console.log(`HTTP ${status}`);
  let created = null;
  try {
    const j = JSON.parse(body);
    created = j.sid ?? null;
    console.log(`  sid    = ${j.sid}`);
    console.log(`  status = ${j.status}`);
    console.log(`  from   = ${j.from}  to = ${j.to}`);
    if (j.message || j.code) console.log(`  error  = ${j.code} ${j.message}`);
  } catch {
    console.log(body.slice(0, 600));
  }
  console.log('\n=== verdict ===');
  if (status >= 400 || !created) {
    console.log('  ✘ SignalWire REFUSED to originate the call. The fault is not our LaML —');
    console.log('    read the error above. Stage B would tell us nothing.');
  } else {
    console.log('  ✔ The call was accepted and a leg exists, so PSTN origination to this');
    console.log('    number works. The fault is in the <Dial> document => go to Stage B.');
    console.log(`\n  Re-read it in a few seconds:\n    node --env-file=.env ${'scripts/signalwire-number-noun-probe.mjs'} --tree=${created}`);
  }
} else {
  console.log(
    [
      'Usage:',
      '  --recent                       list recent inbound calls (read-only)',
      '  --tree=<sid> [--to=+1…]        show a call\'s leg tree and the verdict (read-only)',
      '  --dial --to=+1… --from=+1…     STAGE A: place ONE real call (costs money)',
      '  --inbound --to=<support> --from=<owned> [--mobile=+1…]',
      '                                 STAGE B: trigger a real INBOUND call and read the',
      '                                 leg tree. Tests whatever PHONE_RING_PROBE is set to.',
      '',
      'Run on the Hetzner host — the office TLS proxy blocks SignalWire.',
    ].join('\n'),
  );
}
