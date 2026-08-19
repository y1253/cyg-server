/**
 * One-off: delete the orphaned Luxand subjects left behind by the old 3-subjects-
 * per-user enrolment scheme.
 *
 * MUST run BEFORE `npx prisma db push`. The old ids live only in the FaceImage
 * table; once the push drops it they are unrecoverable, and the subjects sit in the
 * Luxand gallery forever, slowing every future search and burning plan quota.
 *
 *   cd server
 *   node --env-file=.env scripts/luxand-cleanup.mjs            # dry run, just lists
 *   node --env-file=.env scripts/luxand-cleanup.mjs --delete   # actually deletes
 *
 * The id list is written to scripts/luxand-orphans.json first, so a partial failure
 * is resumable and the ids survive the table drop either way.
 */
import { writeFile, readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const TOKEN = process.env.LUXAND_API_KEY;
if (!TOKEN) { console.error('LUXAND_API_KEY missing from server/.env'); process.exit(1); }

const DO_DELETE = process.argv.includes('--delete');
const LIST_PATH = new URL('./luxand-orphans.json', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the ids straight out of the old table; Prisma may no longer model it. */
async function collectIds() {
  try {
    const saved = JSON.parse(await readFile(LIST_PATH, 'utf8'));
    if (Array.isArray(saved) && saved.length) {
      console.log(`Resuming from ${LIST_PATH.pathname} (${saved.length} ids)`);
      return saved;
    }
  } catch { /* no saved list yet — read the table */ }

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT luxandId FROM FaceImage');
    const ids = rows.map((r) => r.luxandId).filter(Boolean);
    await writeFile(LIST_PATH, JSON.stringify(ids, null, 2));
    console.log(`Read ${ids.length} ids from FaceImage -> saved to ${LIST_PATH.pathname}`);
    return ids;
  } catch (e) {
    // Table already dropped and no saved list: nothing we can do, and saying so
    // beats pretending the cleanup succeeded.
    console.error(`Could not read FaceImage: ${e.message}`);
    console.error('If the table is already dropped, those subjects are unrecoverable.');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

const ids = await collectIds();
if (!ids.length) { console.log('Nothing to clean up.'); process.exit(0); }

if (!DO_DELETE) {
  console.log(`\nDRY RUN — ${ids.length} subjects would be deleted from Luxand.`);
  console.log('Re-run with --delete to actually remove them.');
  process.exit(0);
}

let ok = 0, failed = 0;
const remaining = [...ids];
for (const id of ids) {
  try {
    // NB: /subject/{id}, NOT /subject/v2/{id}. The old LuxandService.deletePerson
    // used the latter, which Luxand parses as id="v2" -- so it never deleted
    // anything, which is exactly why these orphans accumulated.
    const res = await fetch(`https://api.luxand.cloud/subject/${id}`, {
      method: 'DELETE',
      headers: { token: TOKEN },
      signal: AbortSignal.timeout(15000),
    });
    const body = await res.text();
    // Luxand answers 200 with {"status":"failure"} on error, so res.ok is not enough.
    if (res.ok && !/"status"\s*:\s*"failure"/.test(body)) {
      ok++;
      remaining.splice(remaining.indexOf(id), 1);
    } else {
      failed++;
      console.warn(`  ${id}: HTTP ${res.status} ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
  } catch (e) {
    failed++;
    console.warn(`  ${id}: ${e.name} ${e.message}`);
  }
  await sleep(200);
}

// Keep only what still needs doing, so a re-run picks up exactly where this stopped.
await writeFile(LIST_PATH, JSON.stringify(remaining, null, 2));
console.log(`\nDeleted ${ok}, failed ${failed}, ${remaining.length} still listed in ${LIST_PATH.pathname}`);
if (failed) console.log('Re-run with --delete to retry the failures.');
