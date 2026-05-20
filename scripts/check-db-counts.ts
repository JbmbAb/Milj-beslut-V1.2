import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = [
    { schema: 'public', name: 'env_registerenhetsomradesytor' },
    { schema: 'env', name: 'env_sgu_jordarter' },
    { schema: 'public', name: 'env_viss_vattenforekomster' },
    { schema: 'public', name: 'env_svar_avrinningsomraden' },
    { schema: 'public', name: 'env_lm_marktacke' },
  ];

  console.log('--- Database Row Counts ---');
  for (const table of tables) {
    try {
      const count = await prisma.$queryRawUnsafe(`SELECT count(*) FROM "${table.schema}"."${table.name}"`);
      console.log(`${table.schema}.${table.name}: ${(count as any)[0].count}`);
    } catch (err: any) {
      console.log(`${table.schema}.${table.name}: Table might not exist or error: ${err.message.split('\n')[0]}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
