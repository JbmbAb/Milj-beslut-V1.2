import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Checking Real Row Counts in Production Schemas ===\n');
  const tables = [
    { schema: 'topo10', table: 'byggnad' },
    { schema: 'env', table: 'registerenhetsomradesytor' },
    { schema: 'env', table: 'registerenhetsomradeslinjer' },
    { schema: 'env', table: 'belagenhetsadress' },
    { schema: 'env', table: 'marktacke' },
    { schema: 'core', table: 'ortnamn' },
    { schema: 'core', table: 'kommuner' },
    { schema: 'core', table: 'lan' },
    { schema: 'core', table: 'rike' },
    { schema: 'hydro', table: 'huvudavrinningsomraden' },
    { schema: 'env', table: 'sgu_fastmark_stabilitet' },
    { schema: 'env', table: 'sgu_soil_type_25k_100k' },
    { schema: 'env', table: 'sgu_jorddjupsmodell_10m' },
    { schema: 'env', table: 'sgu_well' },
    { schema: 'env', table: 'sgu_landslide_feature' },
    { schema: 'env', table: 'sgu_aktsamhet_efterarbetad' },
    { schema: 'env', table: 'ebh_potentiellt_fororenade_omraden' },
    { schema: 'env', table: 'env_sgu_grundvatten_sarbarhet' },
    { schema: 'climate', table: 'flood_risk_area' },
    { schema: 'env', table: 'msb_stabilitetszon' },
  ];

  for (const t of tables) {
    try {
      const countRes = await p.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::bigint as cnt FROM "${t.schema}"."${t.table}"`,
      );
      const count = Number(countRes[0]?.cnt ?? 0);
      console.log(`${String(t.schema + '.' + t.table).padEnd(45)} : ${count.toLocaleString('sv-SE')} rows`);
    } catch (err: any) {
      console.log(`${String(t.schema + '.' + t.table).padEnd(45)} : MISSING (Table does not exist)`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => p.$disconnect());
