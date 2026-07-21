import { PrismaClient } from '@prisma/client';
import { Command } from 'commander';

const prisma = new PrismaClient();

async function verifySpatialPartitions(options: { strict: boolean }) {
  console.log('--- Phase 2: Spatial Grid Partition Verification ---');
  
  const tables = [
    { name: 'registerenhetsomradesytor', schema: 'env' },
    { name: 'lm_mark', schema: 'core' },
    { name: 'lm_byggnad', schema: 'core' }
  ];
  
  let allOk = true;

  for (const table of tables) {
    console.log(`\nChecking table: ${table.schema}.${table.name}`);

    // 1. Check if table is partitioned
    const partInfo = await prisma.$queryRaw<any[]>`
      SELECT nmsp_parent.nspname AS schema_name,
             rel_parent.relname AS table_name,
             pg_get_partkeydef(rel_parent.oid) AS partition_key
      FROM pg_class rel_parent
      JOIN pg_namespace nmsp_parent ON nmsp_parent.oid = rel_parent.relnamespace
      WHERE rel_parent.relkind = 'p' 
        AND rel_parent.relname = ${table.name}
        AND nmsp_parent.nspname = ${table.schema};
    `;

    if (partInfo.length === 0) {
      console.error(`❌ ERROR: Table ${table.schema}.${table.name} is NOT partitioned!`);
      allOk = false;
      continue;
    }
    console.log(`✅ OK: Table is partitioned by ${partInfo[0].partition_key}`);

    // 2. Count partitions (Sweden grid should have approx 136 partitions per table)
    const partitionCount = await prisma.$queryRaw<any[]>`
      SELECT count(*) as count
      FROM pg_inherits
      WHERE inhparent = (
        SELECT c.oid FROM pg_class c 
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = ${table.name} AND n.nspname = ${table.schema} AND c.relkind = 'p'
      );
    `;
    console.log(`ℹ️ Info: Found ${partitionCount[0].count} partitions.`);

    // 3. Data Integrity Check (Legacy vs New)
    const legacyTableName = `${table.name}_legacy`;
    try {
      const legacyCount = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*) FROM "${table.schema}"."${legacyTableName}"`);
      const newCount = await prisma.$queryRawUnsafe<any[]>(`SELECT count(*) FROM "${table.schema}"."${table.name}"`);

      const diff = Number(legacyCount[0].count) - Number(newCount[0].count);
      if (diff === 0) {
        console.log(`✅ OK: Row counts match (${newCount[0].count}).`);
      } else {
        console.error(`❌ ERROR: Row count mismatch! Legacy: ${legacyCount[0].count}, New: ${newCount[0].count} (Diff: ${diff})`);
        allOk = false;
      }
    } catch {
      console.warn(`⚠️ Warning: Could not find legacy table ${table.schema}.${legacyTableName} to compare counts.`);
    }
  }

  if (!allOk && options.strict) {
    process.exit(1);
  }
}

const program = new Command();
program
  .name('verify-spatial-partitions')
  .description('Verify that spatial tables are correctly grid-partitioned.')
  .option('--strict', 'Exit with non-zero code on failure', false)
  .action((options) => {
    verifySpatialPartitions(options)
      .catch(err => {
        console.error('Fatal verification error:', err);
        process.exit(1);
      })
      .finally(async () => {
        await prisma.$disconnect();
      });
  });

program.parse();
