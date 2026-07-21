import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const query = `
    SELECT schemaname, relname, n_live_tup
    FROM pg_stat_user_tables
    WHERE n_live_tup > 0
    ORDER BY n_live_tup DESC;
  `;

  console.log('--- Tables with records (Live Tuple Estimate) ---');
  try {
    const results = await prisma.$queryRawUnsafe(query);
    console.table(results);
  } catch (e) {
    console.error('Error fetching counts:', e);
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
