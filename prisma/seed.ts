import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

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

async function main() {
  const hashed = await bcrypt.hash('Chaim@12345', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'chaim@cygfinance.com' },
    update: {},
    create: {
      name: 'Chaim',
      email: 'chaim@cygfinance.com',
      password: hashed,
      role: 'ADMIN',
    },
  });

  console.log(`Admin seeded: ${admin.email} (id: ${admin.id})`);

  for (const task of QB_TASKS) {
    const t = await prisma.task.upsert({
      where: { title: task.title },
      update: { description: task.description },
      create: { title: task.title, description: task.description, isGeneral: false },
    });
    console.log(`Task seeded: "${t.title}" (id: ${t.id})`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
