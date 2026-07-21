import { PrismaClient } from '@prisma/client';
import { ensureAdminConsoleUser } from '../server/repositories/userRepository';

const prisma = new PrismaClient();

async function main() {
  const username = String(process.env.ADMIN_CONSOLE_USERNAME || 'admin').trim() || 'admin';
  await ensureAdminConsoleUser(username);
  console.log(`Test seed: admin console user ready (${username})`);
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
