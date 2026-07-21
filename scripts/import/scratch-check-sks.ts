import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const tables = [
    'env.sks_slu_markfuktighet_klassad',
    'env.sks_nyckelbiotoper',
    'env.sks_biotopskydd',
    'env.sks_naturvardsavtal',
    'env.sks_avverkningsanmalan'
  ];
  for (const table of tables) {
    try {
      const res: any = await prisma.$queryRawUnsafe(`SELECT count(*)::text as count FROM ${table}`);
      console.log(`Table ${table} exists with count:`, res[0].count);
    } catch (err) {
      console.log(`Table ${table} does NOT exist or failed:`, (err as Error).message);
    }
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
