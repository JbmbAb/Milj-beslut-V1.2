/**
 * scripts/db/adopt-staging-to-prod.ts
 *
 * Mimer Librarian — Rescue Staging Data adoption script.
 * Flyttar historiskt importerad staging-data (lm_staging) till produktionstabeller
 * (env, topo10, hydro, core) snabbt och säkert.
 *
 * Användning:
 *   npx tsx scripts/db/adopt-staging-to-prod.ts --dry-run
 *   npx tsx scripts/db/adopt-staging-to-prod.ts --execute
 */

import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

const EXECUTE = process.argv.includes('--execute');
const DRY_RUN = !EXECUTE;

// Mappning av staging-tabell-prefix till produktionstabell och schema
const TABLE_MAPPINGS: Record<string, { schema: string; table: string; geom_col?: string }> = {
  'byggnad':                         { schema: 'topo10',  table: 'byggnad',                     geom_col: 'geom' },
  'registerenhetsomradesytor':      { schema: 'env',     table: 'registerenhetsomradesytor',   geom_col: 'geom' },
  'registerenhetsomradeslinjer':     { schema: 'env',     table: 'registerenhetsomradeslinjer',  geom_col: 'geom' },
  'belagenhetsadress':               { schema: 'env',     table: 'belagenhetsadress',           geom_col: 'geom' },
  'marktacke':                       { schema: 'env',     table: 'marktacke',                   geom_col: 'geom' },
  'ortnamn':                         { schema: 'core',    table: 'ortnamn',                     geom_col: 'geom' },
  'kommuner':                        { schema: 'core',    table: 'kommuner',                    geom_col: 'geom' },
  'lan':                             { schema: 'core',    table: 'lan',                         geom_col: 'geom' },
  'rike':                            { schema: 'core',    table: 'rike',                        geom_col: 'geom' },
  'huvudavrinningsomraden':          { schema: 'hydro',   table: 'huvudavrinningsomraden',      geom_col: 'geom' },
  'sgu_fastmark_stabilitet':         { schema: 'env',     table: 'sgu_fastmark_stabilitet',     geom_col: 'geom' },
  'sgu_soil_type_25k_100k':          { schema: 'env',     table: 'sgu_soil_type_25k_100k',      geom_col: 'geom' },
  'sgu_jorddjupsmodell_10m':         { schema: 'env',     table: 'sgu_jorddjupsmodell_10m',     geom_col: 'geom' },
  'sgu_well':                        { schema: 'env',     table: 'sgu_well',                    geom_col: 'geom' },
  'sgu_landslide_feature':           { schema: 'env',     table: 'sgu_landslide_feature',       geom_col: 'geom' },
  'sgu_aktsamhet_efterarbetad':      { schema: 'env',     table: 'sgu_aktsamhet_efterarbetad',  geom_col: 'geom' },
  'ebh_potentiellt_fororenade_omraden': { schema: 'env',  table: 'ebh_potentiellt_fororenade_omraden', geom_col: 'geom' },
  'env_sgu_grundvatten_sarbarhet':   { schema: 'env',     table: 'env_sgu_grundvatten_sarbarhet', geom_col: 'geom' },
  'flood_risk_area':                 { schema: 'climate', table: 'flood_risk_area',             geom_col: 'geom' },
  'msb_stabilitetszon':              { schema: 'env',     table: 'msb_stabilitetszon',          geom_col: 'geom' },
  'msb_stabilitetszon_mcf_pilot':    { schema: 'env',     table: 'msb_stabilitetszon_mcf_pilot', geom_col: 'geom' }
};

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
    .filter(c => c.toLowerCase() !== 'id' && set2.has(c.toLowerCase())); // Hoppa över auto-increment ID
}

async function main() {
  console.log('=== Mimer Librarian — Database Staging Adoption Pipeline ===');
  if (DRY_RUN) console.log('🔍 Running in DRY-RUN mode. No modifications will be made.');

  // 1. Hämta alla tabeller i lm_staging
  const stagingTables = await p.$queryRawUnsafe<{ table_name: string }[]>(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'lm_staging' AND table_type = 'BASE TABLE'
  `);

  console.log(`Found ${stagingTables.length} staging tables in lm_staging schema.`);

  for (const stg of stagingTables) {
    const stgTable = stg.table_name;
    
    // Identifiera prefixet för att matcha mot TABLE_MAPPINGS
    // T.ex. byggnad_45ee5ff0 -> prefix: byggnad
    let matchedPrefix = '';
    for (const prefix of Object.keys(TABLE_MAPPINGS)) {
      if (stgTable === prefix || stgTable.startsWith(`${prefix}_`)) {
        // Ta det längsta matchande prefixet (t.ex. msb_stabilitetszon_mcf_pilot före msb_stabilitetszon)
        if (prefix.length > matchedPrefix.length) {
          matchedPrefix = prefix;
        }
      }
    }

    if (!matchedPrefix) {
      console.log(`  ⏭️  Skipping unknown staging table: lm_staging.${stgTable}`);
      continue;
    }

    const mapping = TABLE_MAPPINGS[matchedPrefix];
    const prodSchema = mapping.schema;
    const prodTable = mapping.table;
    const fullStg = `lm_staging.${stgTable}`;
    const fullProd = `${prodSchema}.${prodTable}`;

    // Hämta rader i staging
    const [{ count: stgCount }] = await p.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*)::bigint as count FROM lm_staging."${stgTable}"`
    );
    
    if (Number(stgCount) === 0) {
      console.log(`  ⏭️  Skipping empty staging table: ${fullStg}`);
      continue;
    }

    console.log(`\n📦 Adopting ${fullStg} (${Number(stgCount).toLocaleString('sv-SE')} rows) -> ${fullProd}`);

    // Kontrollera om produktionstabellen finns
    const prodExists = await tableExists(prodSchema, prodTable);
    
    if (!prodExists) {
      console.log(`  🚧 Production table ${fullProd} does not exist. Creating schema structure first...`);
      if (EXECUTE) {
        // Skapa tom produktionstabell med samma struktur som staging
        await p.$executeRawUnsafe(
          `CREATE TABLE ${prodSchema}.${prodTable} AS SELECT * FROM lm_staging."${stgTable}" LIMIT 0`
        );
        // Lägg till primärnyckel
        await p.$executeRawUnsafe(
          `ALTER TABLE ${prodSchema}.${prodTable} ADD COLUMN IF NOT EXISTS id SERIAL PRIMARY KEY`
        );
        console.log(`  ✓ Table structure created.`);
      }
    }

    // Ta reda på gemensamma kolumner
    if (EXECUTE || prodExists) {
      const commonCols = await getCommonColumns('lm_staging', stgTable, prodSchema, prodTable);
      if (commonCols.length === 0) {
        console.error(`  ❌ No common columns found between ${fullStg} and ${fullProd}. Skipping.`);
        continue;
      }
      
      const colString = commonCols.map(c => `"${c}"`).join(', ');
      
      console.log(`  👉 Common columns to copy: ${commonCols.join(', ')}`);

      if (EXECUTE) {
        // Kör TRUNCATE och COPY i en transaktion
        console.log(`  📡 Transferring rows to ${fullProd}...`);
        await p.$transaction([
          p.$executeRawUnsafe(`TRUNCATE ${fullProd} CASCADE`),
          p.$executeRawUnsafe(`INSERT INTO ${fullProd} (${colString}) SELECT ${colString} FROM ${fullStg}`)
        ]);
        console.log(`  ✓ Transferred rows successfully.`);

        // Bygg spatialt index om geometri finns
        if (mapping.geom_col) {
          console.log(`  📐 Creating spatial index on ${fullProd}...`);
          try {
            await p.$executeRawUnsafe(
              `CREATE INDEX IF NOT EXISTS idx_${prodTable}_geom ON ${fullProd} USING gist(${mapping.geom_col})`
            );
            console.log(`  ✓ Spatial index active.`);
          } catch (err: any) {
            console.warn(`  ⚠️ Failed to create spatial index: ${err.message}`);
          }
        }

        // Kör ANALYZE så att frågemotorn känner till raderna
        console.log(`  📊 Analyzing table statistics...`);
        await p.$executeRawUnsafe(`ANALYZE ${fullProd}`);
        console.log(`  ✓ Analysis completed.`);
      }
    }
  }

  console.log('\n🎉 Staging adoption process finished successfully!');
}

main().catch(err => {
  console.error('Fatalt fel i adoptionspipelinen:', err);
  process.exit(1);
}).finally(async () => {
  await p.$disconnect();
});
