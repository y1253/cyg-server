/**
 * SignalWire SIP probe — Phase 0 of the calling increment.
 *
 * Mostly READ-ONLY. The one exception is step 3, which CREATES a single SIP
 * endpoint and DELETES it again, because the registration domain and the AOR are
 * simply not in the docs and cannot be read off a GET when the account has no
 * endpoints yet. SIP endpoints are not billable, so this costs nothing — unlike
 * the phone-number probe, which was forbidden from ever purchasing.
 *
 * Pass --keep to skip the delete if you want to point a real softphone at it.
 *
 *   cd server
 *   node --env-file=.env scripts/signalwire-sip-probe.mjs
 *
 * What it pins down, and why each one is load-bearing:
 *
 *   1. WHICH SIP ENDPOINT API THIS ACCOUNT ACCEPTS. The documented
 *      `POST /api/relay/rest/endpoints/sip` is marked DEPRECATED in favour of
 *      `POST /api/fabric/resources/sip_endpoints`. Deprecated is not the same as
 *      gone, and the replacement may not be enabled on every space. Building on
 *      the wrong one means the softphone has no identity to register as.
 *
 *   2. THE REGISTRATION DOMAIN AND THE AOR. phone-system.md's appendix assumes
 *      `wss://{space}.sip.signalwire.com`, but the current docs never state it.
 *      Everything in the browser half depends on this string being right.
 *
 *   3. THE EXACT RESPONSE SHAPE of a created endpoint, so `sip-endpoints.service.ts`
 *      parses observed fields rather than documented ones. This project has been
 *      burned five times by these docs — most recently by the purchase response's
 *      fabricated `capabilities` block, which cost 31 numbers.
 *
 * Prints raw status + raw body for every call: never res.json(), because the point
 * is to discover the schema, not to assume it.
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

const KEEP = process.argv.includes('--keep');

// The env var holds a BARE host (cygfinance.signalwire.com). If someone pastes a
// full URL in later, strip it rather than building https://https://...
const host = SPACE.replace(/^https?:\/\//, '').replace(/\/+$/, '');
const AUTH = 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');

/** Raw HTTP with the body printed verbatim. Returns { status, body, json }. */
async function call(label, method, path, payload) {
  const url = `https://${host}${path}`;
  const t0 = Date.now();
  let status = '-';
  let body = '';
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: AUTH,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    body = await res.text();
  } catch (err) {
    body = `${err.name}: ${err.message}`;
  }
  console.log(`\n=== ${label} ===`);
  console.log(`${method} ${path}`);
  console.log(`${status}  ${Date.now() - t0}ms`);
  console.log(body.slice(0, 2500) || '(empty body)');
  let json = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* leave null — a non-JSON body is itself a finding */
  }
  return { status, body, json };
}

console.log(`space   : ${host}`);
console.log(`project : ${PROJECT.slice(0, 8)}…`);
console.log(`mode    : ${KEEP ? 'KEEP the test endpoint' : 'create then DELETE'}`);

// ── 1. Which API answers? Both are GET-able and free. ────────────────────────
const fabricList = await call(
  'fabric: list sip endpoints (the documented replacement)',
  'GET',
  '/api/fabric/resources/sip_endpoints',
);
const relayList = await call(
  'relay: list sip endpoints (documented but DEPRECATED)',
  'GET',
  '/api/relay/rest/endpoints/sip',
);

console.log('\n--- API availability ---');
console.log(`fabric /api/fabric/resources/sip_endpoints : ${fabricList.status}`);
console.log(`relay  /api/relay/rest/endpoints/sip       : ${relayList.status}`);

// ── 2. Create ONE endpoint on whichever API answered, to read the AOR. ───────
const useFabric = fabricList.status === 200;
const useRelay = !useFabric && relayList.status === 200;

if (!useFabric && !useRelay) {
  console.log(
    '\n!! Neither SIP endpoint API returned 200. Nothing further can be probed.\n' +
      '   Check that the API token has the Voice scope enabled.',
  );
  process.exit(0);
}

// A name that is obviously disposable, so a leftover is recognisable in the
// dashboard. Not `cyg_u{id}` — that namespace belongs to real users.
const username = `cyg_probe_${Date.now().toString(36)}`;
const password = `Pb!${Buffer.from(String(Math.random())).toString('base64').slice(0, 20)}`;

const created = useFabric
  ? await call('fabric: CREATE test sip endpoint', 'POST', '/api/fabric/resources/sip_endpoints', {
      username,
      password,
      caller_id: 'Cyg Probe',
// encryption is where a browser client most often fails to negotiate; record
// what the API stores when we ask for the permissive value.
      encryption: 'optional',
    })
  : await call('relay: CREATE test sip endpoint', 'POST', '/api/relay/rest/endpoints/sip', {
      username,
      password,
      caller_id: 'Cyg Probe',
      encryption: 'optional',
    });

// ── 3. Report the fields the softphone actually needs. ───────────────────────
// NOTE the two-level shape. The create response is a RESOURCE wrapper around the
// endpoint:
//   { id: <RESOURCE id>, display_name, type, sip_endpoint: { id: <ENDPOINT id>, … } }
// Both are uuids and both look plausible. DELETE is keyed by the OUTER resource id;
// passing the inner one returns 404 and silently leaks the endpoint. Verified.
const resourceId = created.json?.id ?? null;
const row = created.json?.sip_endpoint ?? created.json?.data ?? created.json;

console.log('\n--- WHAT THE SOFTPHONE NEEDS ---');
if (!row || typeof row !== 'object') {
  console.log('Could not parse a created endpoint out of the response above.');
} else {
  console.log('all keys        :', Object.keys(row).join(', '));
  for (const k of [
    'id',
    'username',
    'send_as',
    'caller_id',
    'domain',
    'sip_domain',
    'address',
    'aor',
    'encryption',
    'codecs',
    'ciphers',
  ]) {
    if (k in row) console.log(`${k.padEnd(16)}:`, JSON.stringify(row[k]));
  }
  // The one string the browser cannot work without. If no domain field came
  // back, the appendix's assumption is all we have — say so loudly rather than
  // letting it look confirmed.
  const domain = row.domain ?? row.sip_domain ?? null;
  console.log(
    '\nREGISTRAR       :',
    domain
      ? `wss://${domain}  (OBSERVED)`
      : `wss://${host.split('.')[0]}.sip.signalwire.com  (ASSUMED — no domain field in the response; verify by registering a real client with --keep)`,
  );
}

// ── 4. Clean up, unless asked to keep it. ────────────────────────────────────
// Hunt for the registrar/AOR, which the create response does not carry. Call Fabric
// models a dialable identity as an ADDRESS on the resource; if the SIP domain is
// discoverable anywhere, it is there.
if (useFabric && resourceId) {
  await call('fabric: addresses on this resource', 'GET', `/api/fabric/resources/${resourceId}/addresses`);
  await call('fabric: the resource detail', 'GET', `/api/fabric/resources/${resourceId}`);
  await call('fabric: all space addresses', 'GET', '/api/fabric/addresses');
}

// Cleanup is keyed by the OUTER resource id — see the note in step 3.
const id = resourceId;
if (!KEEP && id) {
  await call(
    'DELETE test sip endpoint (by OUTER resource id)',
    'DELETE',
    useFabric
      ? `/api/fabric/resources/sip_endpoints/${id}`
      : `/api/relay/rest/endpoints/sip/${id}`,
  );
} else if (KEEP) {
  console.log(`\nKept endpoint ${id} (${username} / ${password}) — delete it by hand.`);
} else {
  console.log('\n!! No id parsed, so nothing was deleted. Check the dashboard for', username);
}

console.log('\nDone.');
console.log(
  'Record the API choice, the registrar and the response shape in CLAUDE.md,\n' +
    'then delete this probe — same lifecycle as signalwire-probe.mjs.',
);
