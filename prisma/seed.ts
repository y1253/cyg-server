import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

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
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
