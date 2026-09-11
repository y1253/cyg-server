/**
 * One-off: create the seeded contacts for companies that predate the Contacts feature.
 *
 *   cd server
 *   npx tsx --env-file=.env scripts/backfill-contacts.ts           # report only
 *   npx tsx --env-file=.env scripts/backfill-contacts.ts --write   # actually write
 *
 * ── WHY A SCRIPT AND NOT THE SEED ────────────────────────────────────────────
 * `prisma db seed` upserts with `update: {}` by design — re-running it must never revert
 * an admin's edits — so it will never create these. And `syncAutoContacts` only runs when
 * a company is REGISTERED or EDITED, so an existing company would not get its accountant
 * and owner as contacts until somebody happened to re-save its Details tab.
 *
 * ── WHY TYPESCRIPT, UNLIKE THE OTHER SCRIPTS ─────────────────────────────────
 * The other scripts here are .mjs and talk to Prisma directly. This one imports
 * `ContactsService` and calls the SAME method the app calls, so the rule for which field
 * becomes which contact cannot drift between "new companies" and "old companies" — which
 * is exactly the drift that would be invisible until somebody's caller ID was wrong.
 * `tsx` is already a devDependency (see `prisma.seed` in package.json).
 *
 * Safe to run repeatedly: `syncAutoContacts` is idempotent, and it never touches a
 * hand-made contact.
 */
import { PrismaClient } from '@prisma/client';
import { ContactsService } from '../src/contacts/contacts.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';

const write = process.argv.includes('--write');
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({
    where: { deletedAt: null, isInternal: false },
    select: { id: true, businessName: true },
    orderBy: { id: 'asc' },
  });

  console.log(
    `${companies.length} live client compan${companies.length === 1 ? 'y' : 'ies'}.` +
      (write ? '' : ' DRY RUN — pass --write to apply.'),
  );

  const service = new ContactsService(prisma as unknown as PrismaService);
  let touched = 0;

  for (const company of companies) {
    const before = await prisma.contact.count({
      where: { companyId: company.id, autoSource: { not: null }, deletedAt: null },
    });

    if (write) {
      // The app's own method, not a reimplementation of it.
      await service.syncAutoContacts(company.id);
    }

    const after = write
      ? await prisma.contact.count({
          where: { companyId: company.id, autoSource: { not: null }, deletedAt: null },
        })
      : before;

    if (write && after !== before) {
      touched += 1;
      console.log(
        `  #${company.id} ${company.businessName}: ${before} -> ${after} seeded contact(s)`,
      );
    }
  }

  console.log(
    write
      ? `Done. ${touched} compan${touched === 1 ? 'y' : 'ies'} changed.`
      : 'Nothing written.',
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
