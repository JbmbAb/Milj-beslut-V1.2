import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  try {
    const propertyCount = await prisma.$queryRawUnsafe<any[]>(
      'SELECT count(*) FROM env.registerenhetsomradesytor'
    );
    console.log('Property (Fastighet) count:', propertyCount[0].count);

    const sguCount = await prisma.$queryRawUnsafe<any[]>(
      'SELECT count(*) FROM env.sgu_well'
    );
    console.log('SGU Wells count:', sguCount[0].count);

    const buildingCount = await prisma.$queryRawUnsafe<any[]>(
        'SELECT count(*) FROM core.byggnad'
    );
    console.log('Buildings count:', buildingCount[0].count);

  } catch (err: any) {
    console.error('Error querying database:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();
