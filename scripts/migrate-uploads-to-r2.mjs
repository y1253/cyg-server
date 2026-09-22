/**
 * One-off: move every persisted file from local disk into the Cloudflare R2 bucket.
 *
 *   cd server
 *   node --env-file=.env scripts/migrate-uploads-to-r2.mjs                       # report only
 *   node --env-file=.env scripts/migrate-uploads-to-r2.mjs --apply --keep-local  # upload+verify, delete nothing
 *   node --env-file=.env scripts/migrate-uploads-to-r2.mjs --apply               # upload, verify, delete local
 *   node --env-file=.env scripts/migrate-uploads-to-r2.mjs --orphans             # list files no row names
 *   node --env-file=.env scripts/migrate-uploads-to-r2.mjs --orphans --apply     # ...and delete them
 *
 * Other flags: --table=messages,whatsapp,phone-audio,signature-images   --limit=N
 *
 * ── WHY A SCRIPT AND NOT A MIGRATION ──────────────────────────────────────────
 * Because it moves BYTES, not rows. There is no database write here at all: the four
 * columns involved (`storagePath` on three tables, plus `playbackPath`) already hold a
 * relative, host-independent value like `whatsapp/<uuid>.ogg`, and that string IS the R2
 * object key. A Prisma migration would have nothing to update — and could not copy a file
 * if it wanted to. It also has to be interruptible and re-runnable, which a migration
 * must never be.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────────────
 * Dry run by default. A local file is deleted ONLY after it has been uploaded and then
 * re-read from R2 with a matching size. Re-running is cheap and safe: anything already in
 * the bucket at the right size is skipped. Deleting orphans needs `--orphans --apply`,
 * deliberately two flags, because that half is destructive and unrecoverable.
 *
 * Take the snapshot first (it is small — a few MB):
 *   tar czf ~/uploads-pre-r2-$(date +%F).tar.gz uploads/{messages,whatsapp,phone-audio,signature-images}
 */
import { createReadStream } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

// ── Flags ────────────────────────────────────────────────────────────────────
const apply = process.argv.includes('--apply');
const keepLocal = process.argv.includes('--keep-local');
const orphanMode = process.argv.includes('--orphans');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const tableArg = process.argv.find((a) => a.startsWith('--table='));
const limit = limitArg ? parseInt(limitArg.slice('--limit='.length), 10) : null;
const onlyTables = tableArg
  ? tableArg.slice('--table='.length).split(',').map((s) => s.trim())
  : null;

// ── Env, validated up front ──────────────────────────────────────────────────
const blank = (v) => (v ?? '').trim() === '';
const missing = [
  'DATABASE_URL',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME',
].filter((name) => blank(process.env[name]));
if (missing.length) {
  console.error(`Missing from .env: ${missing.join(', ')}`);
  process.exit(1);
}

const bucket = (process.env.R2_BUCKET ?? process.env.R2_BUCKET_NAME).trim();
// The same rule as src/storage/storage.config.ts, restated because a .mjs script cannot
// import the TypeScript source. Without it, the first --apply on a misconfigured .env
// would fail once PER ROW instead of once with a sentence.
if (/^https?:\/\//i.test(bucket) || bucket.includes('/')) {
  console.error(
    `R2_BUCKET_NAME is "${bucket}" — that is a URL, not a bucket name.\n` +
      'Set R2_BUCKET_NAME=cyg; the endpoint is derived from R2_ACCOUNT_ID.',
  );
  process.exit(1);
}

const endpoint = `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`;
const UPLOADS_ROOT =
  process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

const prisma = new PrismaClient();

console.log(`uploads root : ${UPLOADS_ROOT}`);
console.log(`endpoint     : ${endpoint}`);
console.log(`bucket       : ${bucket}`);
console.log(
  `mode         : ${orphanMode ? 'ORPHAN SWEEP' : 'migrate'}${apply ? (keepLocal ? ' --apply --keep-local' : ' --APPLY') : ' (dry run)'}`,
);
console.log('');

/** Mirrors `resolveStoredPath`: a key must never escape the uploads root. */
function localPathFor(key) {
  const abs = path.resolve(UPLOADS_ROOT, key);
  const root = path.resolve(UPLOADS_ROOT);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`key escapes the uploads root: ${key}`);
  }
  return abs;
}

async function headSize(key) {
  try {
    const res = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return res.ContentLength ?? 0;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') {
      return null;
    }
    throw err;
  }
}

const tally = {
  uploaded: 0,
  already: 0,
  missing: 0,
  conflict: 0,
  error: 0,
  bytes: 0,
};

/**
 * Move one key, and report which of the five things happened.
 *
 * The order is the safety property: upload, re-read, compare the size, and only then
 * unlink. Nothing is deleted that has not been proven readable from the bucket.
 */
async function migrateKey(key, label) {
  let localSize;
  try {
    localSize = (await stat(localPathFor(key))).size;
  } catch {
    localSize = null;
  }

  const remoteSize = await headSize(key);

  if (remoteSize !== null) {
    if (localSize === null) {
      tally.already++;
      return;
    }
    if (remoteSize === localSize) {
      // Already done — this is the branch a re-run takes.
      tally.already++;
      if (apply && !keepLocal) await unlink(localPathFor(key));
      return;
    }
    // Two different files claiming one key. Never overwrite, never delete: a human has
    // to look at this.
    tally.conflict++;
    console.log(
      `  CONFLICT ${label} ${key} — local ${localSize}B vs remote ${remoteSize}B; left alone`,
    );
    return;
  }

  if (localSize === null) {
    // Already 404s today; a key in the log is more diagnosable than a blanked column,
    // so nothing is written back.
    tally.missing++;
    console.log(`  MISSING  ${label} ${key} — no local file, not in bucket`);
    return;
  }

  if (!apply) {
    console.log(`  would upload ${label} ${key} (${localSize}B)`);
    tally.uploaded++;
    tally.bytes += localSize;
    return;
  }

  await new Upload({
    client: s3,
    partSize: 8 * 1024 * 1024,
    queueSize: 4,
    params: {
      Bucket: bucket,
      Key: key,
      Body: createReadStream(localPathFor(key)),
    },
  }).done();

  const verified = await headSize(key);
  if (verified !== localSize) {
    tally.error++;
    console.log(
      `  VERIFY FAILED ${label} ${key} — uploaded ${localSize}B, bucket reports ${verified}B; local file KEPT`,
    );
    return;
  }

  if (!keepLocal) await unlink(localPathFor(key));
  tally.uploaded++;
  tally.bytes += localSize;
  console.log(`  ok ${label} ${key} (${localSize}B)`);
}

/** Page by id so a large table is never loaded at once. */
async function walk(name, fetchPage, keysOf) {
  if (onlyTables && !onlyTables.includes(name)) return;
  console.log(`── ${name}`);
  let cursor = 0;
  let seen = 0;
  for (;;) {
    const take = limit ? Math.min(500, limit - seen) : 500;
    if (take <= 0) break;
    const rows = await fetchPage(cursor, take);
    if (rows.length === 0) break;
    for (const row of rows) {
      for (const key of keysOf(row)) {
        if (!key) continue;
        try {
          await migrateKey(key, `#${row.id}`);
        } catch (err) {
          tally.error++;
          console.log(`  ERROR    #${row.id} ${key} — ${String(err)}`);
        }
      }
      cursor = row.id;
      seen++;
    }
    if (limit && seen >= limit) break;
  }
  console.log('');
}

/**
 * Files on disk that no row names.
 *
 * ⚠️ The four directory names are HARDCODED. Walking UPLOADS_ROOT would also eat the
 * three transit directories (outbound/, whatsapp-outbox/, mms/), which legitimately hold
 * files that no row will ever name.
 */
const PERMANENT_DIRS = [
  'messages',
  'whatsapp',
  'phone-audio',
  'signature-images',
];

async function sweepOrphans() {
  if (tally.error > 0) {
    console.error(
      'Refusing to sweep orphans: the table pass reported errors, so a file that is\n' +
        'merely unread would look unreferenced. Fix those first.',
    );
    process.exitCode = 1;
    return;
  }

  const referenced = new Set();
  const add = (k) => k && referenced.add(k);
  for (const r of await prisma.internalMessageAttachment.findMany({
    select: { storagePath: true },
  })) add(r.storagePath);
  for (const r of await prisma.whatsAppMessage.findMany({
    select: { storagePath: true, playbackPath: true },
  })) {
    add(r.storagePath);
    add(r.playbackPath);
  }
  for (const r of await prisma.phoneAudio.findMany({
    select: { storagePath: true },
  })) add(r.storagePath);
  for (const r of await prisma.signatureImage.findMany({
    select: { storagePath: true },
  })) add(r.storagePath);

  console.log(`── orphan sweep (${referenced.size} keys referenced by rows)`);
  let count = 0;
  let bytes = 0;
  for (const dir of PERMANENT_DIRS) {
    let names;
    try {
      names = await readdir(path.join(UPLOADS_ROOT, dir));
    } catch {
      continue; // directory never existed
    }
    for (const name of names) {
      const key = `${dir}/${name}`;
      if (referenced.has(key)) continue;
      const full = path.join(UPLOADS_ROOT, dir, name);
      const info = await stat(full).catch(() => null);
      if (!info?.isFile()) continue;
      count++;
      bytes += info.size;
      if (apply) {
        await unlink(full);
        console.log(`  deleted ${key} (${info.size}B)`);
      } else {
        console.log(`  would delete ${key} (${info.size}B)`);
      }
    }
  }
  console.log('');
  console.log(
    `${apply ? 'Deleted' : 'Would delete'} ${count} orphan file(s), ${(bytes / 1024).toFixed(1)} KB`,
  );
  if (!apply && count > 0) {
    console.log('Re-run with --orphans --apply to remove them.');
  }
}

try {
  if (!orphanMode) {
    // Smallest and least risky first, so a mistake is found cheaply.
    // ⚠️ No `deletedAt: null` filter anywhere: PhoneAudio and SignatureImage are
    // soft-deleted only, and a settings row may still name a soft-deleted id.
    await walk(
      'signature-images',
      (cursor, take) =>
        prisma.signatureImage.findMany({
          where: { id: { gt: cursor } },
          select: { id: true, storagePath: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (r) => [r.storagePath],
    );
    await walk(
      'phone-audio',
      (cursor, take) =>
        prisma.phoneAudio.findMany({
          where: { id: { gt: cursor } },
          select: { id: true, storagePath: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (r) => [r.storagePath],
    );
    await walk(
      'whatsapp',
      (cursor, take) =>
        prisma.whatsAppMessage.findMany({
          where: {
            id: { gt: cursor },
            OR: [{ storagePath: { not: null } }, { playbackPath: { not: null } }],
          },
          select: { id: true, storagePath: true, playbackPath: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (r) => [r.storagePath, r.playbackPath],
    );
    await walk(
      'messages',
      (cursor, take) =>
        prisma.internalMessageAttachment.findMany({
          where: { id: { gt: cursor } },
          select: { id: true, storagePath: true },
          orderBy: { id: 'asc' },
          take,
        }),
      (r) => [r.storagePath],
    );

    console.log('── summary');
    console.log(`  uploaded : ${tally.uploaded}`);
    console.log(`  already  : ${tally.already}`);
    console.log(`  missing  : ${tally.missing}`);
    console.log(`  conflict : ${tally.conflict}`);
    console.log(`  error    : ${tally.error}`);
    console.log(`  bytes    : ${(tally.bytes / 1024).toFixed(1)} KB`);
    if (!apply) {
      console.log('\nNothing written — re-run with --apply (or --apply --keep-local).');
    }
    if (tally.error > 0 || tally.conflict > 0) process.exitCode = 1;
  } else {
    await sweepOrphans();
  }
} finally {
  await prisma.$disconnect();
}
