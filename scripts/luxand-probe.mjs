/**
 * Luxand API probe — Phase 0 of the face-login rework.
 *
 * Pins down the response shapes the docs don't publish, above all the score field
 * and scale of POST /photo/verify/{uuid}, which the new 1:1 login path depends on.
 * Run it with real photos; it creates one throwaway person and deletes it again.
 *
 *   cd server
 *   node --env-file=.env scripts/luxand-probe.mjs same1.jpg same2.jpg same3.jpg same4.jpg [other.jpg]
 *
 *   same1..3  three photos of ONE person (straight / right / left) -> enrolled
 *   same4     a FOURTH photo of that same person                  -> should MATCH
 *   other     (optional) a photo of a DIFFERENT person            -> should NOT match
 *
 * Prints raw status + raw body for every call: never res.json(), because the point
 * is to discover the schema, not to assume it.
 *
 * Delete this file once the findings are recorded.
 */
import { readFile } from 'node:fs/promises';

const TOKEN = process.env.LUXAND_API_KEY;
if (!TOKEN) { console.error('LUXAND_API_KEY missing from server/.env'); process.exit(1); }

const BASE = 'https://api.luxand.cloud';
const [s1, s2, s3, s4, other] = process.argv.slice(2);
if (!s1 || !s2 || !s3 || !s4) {
  console.error('Need at least 4 photos: same1 same2 same3 same4 [other]');
  process.exit(1);
}

const load = async (p) => new Blob([new Uint8Array(await readFile(p))], { type: 'image/jpeg' });

async function call(label, method, path, build) {
  const form = new FormData();
  if (build) await build(form);
  const t0 = Date.now();
  let status, body;
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: { token: TOKEN },
      ...(build ? { body: form } : {}),
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    body = await res.text();
  } catch (e) {
    status = 'ERR';
    body = `${e.name}: ${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`;
  }
  const ms = Date.now() - t0;
  console.log(`\n--- ${label}\n    ${method} ${path}\n    HTTP ${status}   ${ms}ms\n    ${body.replace(/\s+/g, ' ').slice(0, 700)}`);
  return { status, body, ms };
}

// 1. create a person holding all three photos in ONE request
const created = await call('1. create person (3 photos, one request)', 'POST', '/v2/person', async (f) => {
  f.append('name', 'ZZ PROBE — delete me');
  f.append('store', '1');
  f.append('photos', await load(s1), 's1.jpg');
  f.append('photos', await load(s2), 's2.jpg');
  f.append('photos', await load(s3), 's3.jpg');
});

let uuid;
try {
  const j = JSON.parse(created.body);
  uuid = j.uuid ?? j.id ?? j.person?.uuid ?? j.result?.uuid;
} catch { /* non-JSON body */ }
console.log(`\n>>> parsed person id: ${uuid ?? 'NOT FOUND — read the raw body above'}`);
if (!uuid) { console.error('\nCannot continue without a person id.'); process.exit(1); }

// 2. incremental photo add
await call('2. add a 4th photo to the same person', 'POST', `/v2/person/${uuid}`, async (f) => {
  f.append('photo', await load(s4), 's4.jpg');
  f.append('store', '1');
});

// 3. THE load-bearing call: 1:1 verify, same person
await call('3. verify — SAME person (expect match)', 'POST', `/photo/verify/${uuid}`, async (f) => {
  f.append('photo', await load(s4), 's4.jpg');
});

// 4. verify, different person
if (other) {
  await call('4. verify — DIFFERENT person (expect no match)', 'POST', `/photo/verify/${uuid}`, async (f) => {
    f.append('photo', await load(other), 'other.jpg');
  });
} else {
  console.log('\n--- 4. skipped (no "other" photo given) — rerun with a 5th arg to get the impostor score');
}

// 6. 1:N search, for the latency comparison that justifies the whole change
await call('6. search v2 (1:N, the OLD login path)', 'POST', '/photo/search/v2', async (f) => {
  f.append('photo', await load(s4), 's4.jpg');
});

// 7. liveness
await call('7. liveness v2', 'POST', '/photo/liveness/v2', async (f) => {
  f.append('photo', await load(s4), 's4.jpg');
});

// 8. cleanup — never leave the probe person in the real gallery
await call('8. delete the probe person', 'DELETE', `/v2/person/${uuid}`, null);

console.log(`

================= WHAT TO RECORD =================
From #3: the score field name and its scale (0-1 or 0-100)  -> LUXAND_VERIFY_MIN_CONFIDENCE
From #4: the impostor score, so the threshold sits between #3 and #4
From #7: the liveness score field + scale                   -> LUXAND_LIVENESS_MIN
Compare #3 ms vs #6 ms: the verify-vs-search win
Confirm #8 actually removed the person (no "ZZ PROBE" left in the Luxand console)
==================================================
`);
