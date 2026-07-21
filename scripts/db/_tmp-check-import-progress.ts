import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const tables = [
    'env.sgu_bergartskemi_bergartskemi_bergartskemi',
    'env.sgu_landslide_feature',
    'env.sgu_ground_layer_1m',
    'env.sgu_soil_type_25k_100k',
    'env.land_cover',
    'env.geophysics',
  ];
  for (const t of tables) {
    const reg = await prisma.$queryRawUnsafe<{ reg: string | null }[]>(
      `SELECT to_regclass('${t}')::text AS reg`,
    );
    if (!reg[0]?.reg) {
      console.log(`${t}: SAKNAS`);
      continue;
    }
    const c = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM ${t}`);
    console.log(`${t}: ${c[0]?.n ?? 0} rader`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
