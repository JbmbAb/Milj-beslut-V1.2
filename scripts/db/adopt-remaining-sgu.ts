import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;

const REMAINING_MAPPINGS = [
  {
    stgTable: 'sgu_blockighet_750k_d2ab3aff',
    prodSchema: 'env',
    prodTable: 'sgu_blockighet_750k',
    geomCol: 'geom'
  },
  {
    stgTable: 'sgu_erosion_aktiv_06dc4ff8',
    prodSchema: 'env',
    prodTable: 'sgu_erosion_aktiv',
    geomCol: 'geom'
  },
  {
    stgTable: 'sgu_landform_750k_bc352cf5',
    prodSchema: 'env',
    prodTable: 'sgu_landform_750k',
    geomCol: 'geom'
  }
];

async function tableExists(schema: string, name: string): Promise<boolean> {
  const [{ exists }] = await p.$queryRawUnsafe<[{ exists: boolean }]>(
    `SELECT EXISTS (
       SELECT FROM information_schema.tables 
       WHERE table_schema = $1 AND table_name = $2
     ) AS exists`,
    schema, name
  );
  return exists;
}

async function getCommonColumns(schema1: string, table1: string, schema2: string, table2: string): Promise<string[]> {
  const cols1 = await p.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    schema1, table1
  );
  const cols2 = await p.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    schema2, table2
  );
  
  const set2 = new Set(cols2.map(c => c.column_name.toLowerCase()));
  return cols1
    .map(c => c.column_name)
    .filter(c => c.toLowerCase() !== 'id' && set2.has(c.toLowerCase()));
}

async function main() {
  console.log('=== Mimer Librarian — Adopting Remaining SGU Tables ===');
  if (DRY_RUN) console.log('🔍 DRY-RUN MODE active.');

  for (const m of REMAINING_MAPPINGS) {
    const fullStg = `lm_staging."${m.stgTable}"`;
    const fullProd = `"${m.prodSchema}"."${m.prodTable}"`;

    if (!await tableExists('lm_staging', m.stgTable)) {
      console.log(`⚠️ Staging table ${fullStg} does not exist. Skipping.`);
      continue;
    }

    const [{ count: stgCount }] = await p.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*)::bigint as count FROM ${fullStg}`
    );

    console.log(`\n📦 Adopting ${fullStg} (${Number(stgCount).toLocaleString('sv-SE')} rows) -> ${fullProd}`);

    const prodExists = await tableExists(m.prodSchema, m.prodTable);
    if (!prodExists) {
      console.log(`  🚧 Creating production table ${fullProd} structure...`);
      if (EXECUTE) {
        await p.$executeRawUnsafe(
          `CREATE TABLE ${fullProd} AS SELECT * FROM ${fullStg} LIMIT 0`
        );
        await p.$executeRawUnsafe(
          `ALTER TABLE ${fullProd} ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY`
        );
        console.log('  ✓ Table created.');
      }
    }

    if (EXECUTE || prodExists) {
      const commonCols = await getCommonColumns('lm_staging', m.stgTable, m.prodSchema, m.prodTable);
      const colString = commonCols.map(c => `"${c}"`).join(', ');

      if (EXECUTE) {
        console.log(`  📡 Copying rows...`);
        await p.$transaction([
          p.$executeRawUnsafe(`TRUNCATE ${fullProd} CASCADE`),
          p.$executeRawUnsafe(`INSERT INTO ${fullProd} (${colString}) SELECT ${colString} FROM ${fullStg}`)
        ]);
        console.log('  ✓ Rows copied.');

        if (m.geomCol) {
          console.log(`  📐 Creating spatial index...`);
          try {
            await p.$executeRawUnsafe(
              `CREATE INDEX IF NOT EXISTS idx_${m.prodTable}_geom ON ${fullProd} USING gist(${m.geomCol})`
            );
            console.log('  ✓ Spatial index active.');
          } catch (err: any) {
            console.warn(`  ⚠️ Spatial index failed: ${err.message}`);
          }
        }

        console.log('  📊 Analyzing statistics...');
        await p.$executeRawUnsafe(`ANALYZE ${fullProd}`);
        console.log('  ✓ Table ready!');
      }
    }
  }

  console.log('\n🎉 Finished adopting remaining SGU tables!');
}

main().catch(console.error).finally(() => p.$disconnect());
