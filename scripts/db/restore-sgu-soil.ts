import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Restoring Full SGU Soil Type (2.95M Rows) ===');

  const fullStg = 'lm_staging.sgu_soil_type_25k_100k_2bd32199';
  const fullProd = 'env.sgu_soil_type_25k_100k';

  // Hämta gemensamma kolumner
  const cols1 = await p.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'lm_staging' AND table_name = 'sgu_soil_type_25k_100k_2bd32199'`,
  );
  const cols2 = await p.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'env' AND table_name = 'sgu_soil_type_25k_100k'`,
  );

  const set2 = new Set(cols2.map((c) => c.column_name.toLowerCase()));
  const commonCols = cols1
    .map((c) => c.column_name)
    .filter((c) => c.toLowerCase() !== 'id' && set2.has(c.toLowerCase()));

  const colString = commonCols.map((c) => `"${c}"`).join(', ');

  console.log(`Copying rows from ${fullStg} to ${fullProd}...`);

  await p.$transaction([
    p.$executeRawUnsafe(`TRUNCATE ${fullProd} CASCADE`),
    p.$executeRawUnsafe(`INSERT INTO ${fullProd} (${colString}) SELECT ${colString} FROM ${fullStg}`),
  ]);

  console.log('✓ Rows copied. Creating spatial index...');
  try {
    await p.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS idx_sgu_soil_type_25k_100k_geom ON ${fullProd} USING gist(geom)`,
    );
    console.log('✓ Spatial index active.');
  } catch (err: any) {
    console.log('⚠️ Spatial index warn:', err.message);
  }

  console.log('📊 Analyzing table statistics...');
  await p.$executeRawUnsafe(`ANALYZE ${fullProd}`);
  console.log('✓ Analysis completed. SGU Soil Type restored!');
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
