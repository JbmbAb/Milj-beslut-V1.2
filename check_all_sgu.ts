import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  try {
    const tables = [
      'env.sgu_ground_layer',
      'env.sgu_landslide_feature',
      'env.env_sgu_jordarter',
      'env.env_sgu_grundvatten_sarbarhet',
      'env.sgu_soil_type',
      'env.sgu_well'
    ];

    for (const table of tables) {
      try {
        const result = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*) as count FROM ${table}`);
        console.log(`${table} count:`, result[0].count);
      } catch (e: any) {
        console.log(`${table} error:`, e.message);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

check();
