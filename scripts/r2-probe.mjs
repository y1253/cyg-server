/**
 * Prove the Cloudflare R2 bucket is reachable and behaves the way the storage layer
 * assumes, BEFORE any of it is wired into the app.
 *
 *   cd server
 *   node --env-file=.env scripts/r2-probe.mjs
 *
 * ── WHAT IT COSTS ─────────────────────────────────────────────────────────────
 * One tiny object (a few hundred bytes) is written, read back four ways, and
 * deleted. Under R2's free operation allowance this is free, and it leaves nothing
 * behind. It writes under `_probe/` so it can never collide with a real key.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────
 * Four assumptions the storage layer is built on are unverified until something
 * actually talks to the bucket, and every one of them fails in a way that is easy
 * to misread as something else:
 *
 *   1. THE BUCKET NAME. `.env` shipped with R2_BUCKET_NAME holding the S3 *endpoint
 *      URL* rather than a name. A URL-shaped bucket 400s on every single request,
 *      which reads like bad credentials.
 *   2. THE ENDPOINT. It is DERIVED from R2_ACCOUNT_ID, never read from env, so a
 *      wrong account id looks like a DNS failure.
 *   3. FLEXIBLE CHECKSUMS. Recent @aws-sdk/client-s3 sends x-amz-checksum-crc32 by
 *      default and has broken against R2 before. Every PUT fails identically, from
 *      the very first one. This probe runs the PUT BOTH ways and says which works,
 *      so the setting is read off a result instead of guessed.
 *   4. RANGED GETS. The whole attachment read path is Range/206 — a scrubbed video
 *      depends on it. R2 is expected to honour both a closed range and the SUFFIX
 *      form `bytes=-N` (media players use it to grab an MP4's trailing moov atom).
 *
 * Re-runnable, and safe to run against production: it touches one key under a
 * reserved prefix and removes it.
 */
import { randomUUID } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

// ── Env, validated up front with a named list ────────────────────────────────
const blank = (v) => (v ?? '').trim() === '';
const missing = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
].filter((name) => blank(process.env[name]));

if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}`);
  process.exit(1);
}

const accountId = process.env.R2_ACCOUNT_ID.trim();
const bucket = (process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME).trim();

// The same check `src/storage/storage.config.ts` makes, restated here because a
// .mjs script cannot import the TypeScript source. Without it, the first PUT fails
// once per attempt with an opaque 400 instead of once with a sentence.
if (/^https?:\/\//i.test(bucket) || bucket.includes('/')) {
  console.error(
    `R2_BUCKET_NAME is "${bucket}".\n` +
      'That is a URL, not a bucket name. Set R2_BUCKET_NAME=cyg — the endpoint is\n' +
      'derived from R2_ACCOUNT_ID, so this variable is the bucket NAME only.',
  );
  process.exit(1);
}

const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
const credentials = {
  accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
};

console.log(`endpoint : ${endpoint}`);
console.log(`bucket   : ${bucket}`);
console.log('');

const key = `_probe/${randomUUID()}.txt`;
// Deliberately not round: an off-by-one in range maths is invisible on a 100-byte body.
const body = Buffer.from('cyg r2 probe '.repeat(17), 'utf8');

function clientWith(checksums) {
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials,
    forcePathStyle: true,
    ...(checksums === 'when-required' && {
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    }),
  });
}

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ── 1. PUT, both checksum modes ──────────────────────────────────────────────
// Run the default first: if it works, nothing needs configuring and that is worth
// knowing. WHEN_REQUIRED is the fallback the storage service will pin.
let client = null;
let checksumMode = null;

for (const mode of ['default', 'when-required']) {
  const candidate = clientWith(mode);
  try {
    await candidate.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: 'text/plain',
        // No ACL, ever — R2 has no ACLs and rejects the header.
      }),
    );
    record(`PUT (checksums: ${mode})`, true);
    client = candidate;
    checksumMode = mode;
    break;
  } catch (err) {
    record(`PUT (checksums: ${mode})`, false, String(err?.name ?? err));
  }
}

if (!client) {
  console.error(
    '\nNothing was written. Both checksum modes failed — so this is credentials,\n' +
      'bucket name, or account id, not the SDK. Check the two lines printed above\n' +
      'against the Cloudflare dashboard (R2 > Manage API tokens).',
  );
  process.exit(1);
}

try {
  // ── 2. HEAD — the read path's 404-before-headers guarantee rests on this ────
  try {
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const ok = head.ContentLength === body.length;
    record(
      'HEAD returns the exact size',
      ok,
      `${head.ContentLength} vs ${body.length}`,
    );
  } catch (err) {
    record('HEAD returns the exact size', false, String(err?.name ?? err));
  }

  // ── 3. HEAD on a key that does not exist must be a clean 404, not a hang ────
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: `${key}.nope` }),
    );
    record('HEAD on a missing key 404s', false, 'it succeeded — unexpected');
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    record('HEAD on a missing key 404s', status === 404, `status ${status}`);
  }

  // ── 4. Whole-object GET ────────────────────────────────────────────────────
  try {
    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const bytes = await readAll(got.Body);
    record('GET returns the same bytes', bytes.equals(body));
  } catch (err) {
    record('GET returns the same bytes', false, String(err?.name ?? err));
  }

  // ── 5. Closed range ────────────────────────────────────────────────────────
  try {
    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=10-19' }),
    );
    const bytes = await readAll(got.Body);
    const ok = bytes.equals(body.subarray(10, 20));
    record(
      'ranged GET bytes=10-19',
      ok,
      `${bytes.length}B, Content-Range: ${got.ContentRange ?? 'absent'}`,
    );
  } catch (err) {
    record('ranged GET bytes=10-19', false, String(err?.name ?? err));
  }

  // ── 6. Suffix range — what a media player asks for when it seeks ───────────
  try {
    const got = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: 'bytes=-8' }),
    );
    const bytes = await readAll(got.Body);
    const ok = bytes.equals(body.subarray(body.length - 8));
    record(
      'suffix range bytes=-8 is the LAST 8 bytes',
      ok,
      `got "${bytes.toString('utf8')}"`,
    );
  } catch (err) {
    record('suffix range bytes=-8 is the LAST 8 bytes', false, String(err?.name ?? err));
  }
} finally {
  // ── 7. DELETE — leave nothing behind, even if an assertion above threw ──────
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    record('DELETE removes the probe object', true);
  } catch (err) {
    record('DELETE removes the probe object', false, String(err?.name ?? err));
    console.error(`\n⚠️  Left behind: ${key} — remove it by hand.`);
  }
}

// ── Verdict ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length === 0) {
  console.log(`All ${results.length} checks passed. R2 is usable from this machine.`);
  console.log(
    checksumMode === 'default'
      ? 'Checksums: the SDK default works. WHEN_REQUIRED is still what the service\n' +
          'pins, since it is the safer of two working options.'
      : 'Checksums: the SDK DEFAULT FAILED and WHEN_REQUIRED worked. That setting in\n' +
          'object-storage.service.ts is load-bearing — do not remove it.',
  );
} else {
  console.log(`${failed.length} of ${results.length} checks FAILED:`);
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exitCode = 1;
}
