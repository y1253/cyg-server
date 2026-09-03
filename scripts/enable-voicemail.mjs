/**
 * One-off: switch voicemail on in the GLOBAL phone defaults row.
 *
 *   cd server
 *   node --env-file=.env scripts/enable-voicemail.mjs           # show current state only
 *   node --env-file=.env scripts/enable-voicemail.mjs --on      # take messages
 *   node --env-file=.env scripts/enable-voicemail.mjs --off     # hang up (the rollback)
 *
 * ── WHY A SCRIPT AND NOT A MIGRATION ──────────────────────────────────────────
 * `voicemailEnabled` now defaults to true in schema.prisma, but a Prisma default only
 * applies to rows being CREATED. `PhoneSettingsDefault` is a singleton that already
 * exists on every deployed database, and the seed upserts it with `update: {}` -- which
 * is load-bearing, since re-running the seed must never revert an admin's edits. So
 * neither the schema change nor `prisma db push` nor `prisma db seed` will flip an
 * existing row. This is the thing that does.
 *
 * Safe to run more than once: it writes one column of one row and prints what changed.
 * It deliberately does NOT touch per-company overrides -- a company that has explicitly
 * chosen a value keeps it, which is what "override" means.
 */
import { PrismaClient } from '@prisma/client';

const SINGLETON = 'GLOBAL';

const on = process.argv.includes('--on');
const off = process.argv.includes('--off');

if (on && off) {
  console.error('Pass --on or --off, not both.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const row = await prisma.phoneSettingsDefault.findUnique({
    where: { singleton: SINGLETON },
    select: { voicemailEnabled: true, voicemailMaxSeconds: true, voicemailPrompt: true },
  });

  if (!row) {
    // Creating it here would guess at every other column. The seed owns that.
    console.error(
      `No PhoneSettingsDefault row with singleton="${SINGLETON}".\n` +
        'Run `npx prisma db seed` first -- it creates the row from SEED_DEFAULTS.',
    );
    process.exit(1);
  }

  console.log(`Currently: voicemail is ${row.voicemailEnabled ? 'ON' : 'OFF'}`);
  console.log(`  prompt : "${row.voicemailPrompt}"`);
  console.log(`  max    : ${row.voicemailMaxSeconds}s`);

  if (!on && !off) {
    console.log('\nNothing changed. Pass --on to take messages, --off to hang up.');
    return;
  }

  const next = on;
  if (row.voicemailEnabled === next) {
    console.log(`\nAlready ${next ? 'ON' : 'OFF'} -- nothing to do.`);
    return;
  }

  await prisma.phoneSettingsDefault.update({
    where: { singleton: SINGLETON },
    data: { voicemailEnabled: next },
  });

  console.log(`\nVoicemail is now ${next ? 'ON' : 'OFF'} globally.`);
  console.log(
    next
      ? 'Companies with their own override are unaffected; they keep whatever they chose.'
      : 'Callers who reach nobody will be hung up on again.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
