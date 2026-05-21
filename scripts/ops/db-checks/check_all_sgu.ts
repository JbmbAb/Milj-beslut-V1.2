import { Prisma, PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

type CountRow = {
  count: bigint;
};

const SGU_TABLES = [
  'env.sgu_ground_layer',
  'env.sgu_landslide_feature',
  'env.env_sgu_jordarter',
  'env.env_sgu_grundvatten_sarbarhet',
  'env.sgu_soil_type',
  'env.sgu_well',
] as const;

async function check() {
  try {
    for (const table of SGU_TABLES) {
      try {
        // Table names are from a hardcoded allowlist; no external input is used here.
        const result = await prisma.$queryRaw<CountRow[]>(
          Prisma.sql`SELECT count(*)::bigint AS count FROM ${Prisma.raw(table)}`,
        );
        console.log(`${table} count:`, Number(result[0]?.count ?? 0n));
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        console.log(`${table} error:`, message);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

check();
