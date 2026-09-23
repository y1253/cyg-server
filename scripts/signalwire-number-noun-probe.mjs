/**
 * Why does a `<Number>` noun inside our inbound `<Dial>` produce no leg at all?
 *
 * ── THE FAILURE THIS EXISTS FOR ─────────────────────────────────────────────────
 * With `ringMobiles` on, `ringAndDial` emits ONE `<Dial>` holding a `<Sip>` noun for the
 * browsers and a `<Number url=…>` noun for the assigned user's mobile. The server log shows
 * the noun being emitted -- `ringing St. Paul -> users [17] + mobiles [+1…]` -- and the
 * phone never rings. Reading the call back from SignalWire, the inbound call has exactly
 * ONE child: the SIP leg. There is no leg for the mobile, not even a `failed` one.
 *
 * "No leg at all" is the whole clue. An unreachable or invalid number still produces a leg
 * with `status: failed`. Nothing means SignalWire discarded the noun before dialling.
 *
 * SignalWire exposes no per-call diagnostics -- `Calls/{sid}/Notifications` and `/Events`
 * both 404 on this account -- so the only way to tell the candidates apart is to change one
 * thing at a time and read the leg tree back. That is what this does.
 *
 * ⚠️ RUN THIS ON THE HETZNER HOST. The office "Geder Filter" re-signs TLS and Node rejects
 * SignalWire's certificate, so every request here fails locally with
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * ── USAGE ───────────────────────────────────────────────────────────────────────
 *   # read-only: show the leg tree of a call that already happened
 *   node --env-file=.env scripts/signalwire-number-noun-probe.mjs --tree=<inbound call sid>
 *
 *   # read-only: the most recent inbound calls, so you can find that sid
 *   node --env-file=.env scripts/signalwire-number-noun-probe.mjs --recent
 *
 *   # STAGE A -- places ONE real call. Can this account dial that number at all?
 *   node --env-file=.env scripts/signalwire-number-noun-probe.mjs \
 *        --dial --to=+19295451253 --from=+14382561210
 *
 * Read-only by default. `--dial` is the only thing that spends money, it places exactly one
 * short call, and nobody has to answer it -- the answer is whether the LEG EXISTS, which is
 * read back from the API either way.
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
      '  => Consistent with SignalWire honouring only the FIRST noun in a <Dial>,\n' +
        '     or rejecting <Number url=…>. Stage B tells those apart.',
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
      '',
      'Run on the Hetzner host — the office TLS proxy blocks SignalWire.',
    ].join('\n'),
  );
}
