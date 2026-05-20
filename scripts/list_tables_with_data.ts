import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  try {
    const res = await prisma.$queryRawUnsafe(`
      SELECT schemaname, relname, n_live_tup 
      FROM pg_stat_user_tables 
      ORDER BY n_live_tup DESC
    `);
    console.log('Tables with rows:', res);
  } catch (err) {
    console.error('Error:', err);
  } finally {
    await prisma.$disconnect();
  }
}
main();
