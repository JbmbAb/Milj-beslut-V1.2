import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = [
    'env.sgu_ground_layer',
    'env.sgu_well',
    'public.env_registerenhetsomradesytor',
    'env.sgu_soil_type',
    'env.kulturmiljo_omrade',
    'env.marktacke',
    'topo10.vatten',
    'topo10.mark',
    'topo10.byggnad'
  ];

  console.log('--- Real Record Counts ---');
  for (const table of tables) {
    try {
      const result = await prisma.$queryRawUnsafe(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`${table}: ${(result as any)[0].count}`);
    } catch (e) {
      console.log(`${table}: (error or not found)`);
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
