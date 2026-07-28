import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import { ensureInternalWorkspace } from '../src/companies/internal-workspace.js';

const prisma = new PrismaClient();

const QB_TASKS = [
  {
    title: 'Follow up: Verify QuickBooks invite sent',
    description:
      'Follow up with the company to confirm they sent an invitation to chaim@cygfinance.com as their accountant in QuickBooks.',
  },
  {
    title: 'Open QuickBooks Online Essentials',
    description: 'Set up a QuickBooks Online Essentials account for this new client.',
  },
  {
    title: 'Open QuickBooks Online Plus',
    description: 'Set up a QuickBooks Online Plus account for this new client.',
  },
  {
    title: 'Open QuickBooks Online Advanced',
    description: 'Set up a QuickBooks Online Advanced account for this new client.',
  },
];

/**
 * The env-admin needs a real User row: internal messages carry a `senderId` FK and
 * the client compares `user.id` to decide what is "mine". `adminLogin` upserts this
 * too, so seeding it is belt-and-braces for a fresh database.
 */
async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  if (!email) {
    console.warn('ADMIN_EMAIL not set — skipping admin seed');
    return;
  }
  const name = process.env.ADMIN_NAME ?? 'Admin';
  const admin = await prisma.user.upsert({
    where: { email },
    update: { deletedAt: null, role: Role.ADMIN },
    create: { name, email, role: Role.ADMIN },
  });
  console.log(`Admin seeded: ${admin.email} (id: ${admin.id})`);
}

/**
 * Give every existing user their private "Cyg Finance" workspace. New users get
 * one automatically in UsersService.create; this backfills everyone who predates
 * that. Idempotent — `Company.internalOwnerId` is @unique, so re-running is safe.
 */
async function backfillInternalWorkspaces() {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, email: true },
  });
  let created = 0;
  for (const user of users) {
    const existing = await prisma.company.findUnique({
      where: { internalOwnerId: user.id },
      select: { id: true },
    });
    await ensureInternalWorkspace(prisma, user.id);
    if (!existing) created++;
  }
  console.log(
    `Internal workspaces: ${users.length} user(s) checked, ${created} created`,
  );
}

async function main() {
  for (const task of QB_TASKS) {
    const t = await prisma.task.upsert({
      where: { title: task.title },
      update: { description: task.description },
      create: { title: task.title, description: task.description, isGeneral: false },
    });
    console.log(`Task seeded: "${t.title}" (id: ${t.id})`);
  }

  await seedAdmin();
  await backfillInternalWorkspaces();
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
