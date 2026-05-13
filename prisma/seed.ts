import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

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
