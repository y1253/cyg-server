/**
 * Phase 2a spike — create ONE SIP endpoint so a browser can try to register.
 *
 * THROWAWAY. Delete once the softphone increment is real; `sip-endpoints.service.ts`
 * is the production path.
 *
 *   node --env-file=.env scripts/sip-spike.mjs create   # print credentials
 *   node --env-file=.env scripts/sip-spike.mjs list
 *   node --env-file=.env scripts/sip-spike.mjs delete
 *
 * Two things it is deliberately careful about, both learned the hard way:
 *
 *  1. `encryption: "required"`. A browser negotiates DTLS-SRTP and will not talk to an
 *     endpoint that allows plaintext; the Phase 0 probe used "optional", which would
 *     have failed here for a reason that looks like a registration bug.
 *
 *  2. DELETE is keyed by the OUTER resource id, not `sip_endpoint.id`. Both are uuids,
 *     both look right, and passing the inner one returns 404 while silently leaking the
 *     endpoint. The Phase 0 probe leaked one exactly this way.
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
const AUTH = 'Basic ' + Buffer.from(`${PROJECT}:${TOKEN}`).toString('base64');
const BASE = `https://${host}/api/fabric/resources/sip_endpoints`;

/** The SIP domain. Verified to resolve with valid TLS; the API never reports it. */
const SIP_DOMAIN = `${host.split('.')[0]}.sip.signalwire.com`;

const USERNAME = 'cyg_u16'; // userId 16 — the assigned user of +14382561210

async function api(method, path = '', payload) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: AUTH,
      Accept: 'application/json',
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body is itself the finding */
  }
  return { status: res.status, text, json };
}

const cmd = process.argv[2] ?? 'create';

if (cmd === 'list') {
  const { status, json } = await api('GET');
  console.log('status', status);
  for (const r of json?.data ?? []) {
    console.log(` outer=${r.id} inner=${r.sip_endpoint?.id} ${r.display_name}`);
  }
  console.log(`(${json?.data?.length ?? 0} total)`);
} else if (cmd === 'delete') {
  const { json } = await api('GET');
  for (const r of json?.data ?? []) {
    // OUTER id. See the header note.
    const res = await api('DELETE', `/${r.id}`);
    console.log(`deleted ${r.display_name} -> ${res.status}`);
  }
} else {
  // Random, URL-safe, no characters that need escaping in a SIP header.
  const password =
    'Cyg' +
    Buffer.from(crypto.getRandomValues(new Uint8Array(18)))
      .toString('base64')
      .replace(/[^A-Za-z0-9]/g, '')
      .slice(0, 20);

  const { status, text, json } = await api('POST', '', {
    username: USERNAME,
    password,
    caller_id: 'Cyg Finance',
    // See header note 1 — a browser will not negotiate without this.
    encryption: 'required',
  });

  console.log('create status:', status);
  if (status >= 300) {
    console.log(text.slice(0, 500));
    process.exit(1);
  }

  console.log('\n──────── SOFTPHONE CREDENTIALS ────────');
  console.log('SIP username    :', json.sip_endpoint?.username);
  console.log('SIP password    :', password);
  console.log('SIP URI         :', `sip:${USERNAME}@${SIP_DOMAIN}`);
  console.log('WebSocket (WSS) :', `wss://${SIP_DOMAIN}`);
  console.log('Registrar       :', SIP_DOMAIN);
  console.log('encryption      :', json.sip_endpoint?.encryption);
  console.log('outer resource  :', json.id, '  <- the id that DELETEs');
  console.log('inner endpoint  :', json.sip_endpoint?.id, '  <- NOT the delete key');
  console.log('───────────────────────────────────────');
}
