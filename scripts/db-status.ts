import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Database Content Status ---');
  try {
    const tableCounts: Record<string, number> = {};
    
    // Core tables
    const coreTables = [
      'public."User"', 'public."Organisation"', 'public."Project"', 
      'public."DocumentRecord"', 'public."RequirementRecord"', 
      'public."RequirementCase"', 'public."AuditTrail"'
    ];

    for (const table of coreTables) {
      try {
        const result: any = await prisma.$queryRawUnsafe(`SELECT count(*) as count FROM ${table}`);
        tableCounts[table] = Number(result[0].count);
      } catch {
        tableCounts[table] = -1; // Not found
      }
    }

    // Spatial tables
    const spatialTables = [
      'env.sgu_ground_layer', 'env.sgu_landslide_feature', 
      'env.protected_area', 'env.natura2000_area', 
      'hydro.water_body'
    ];

    for (const table of spatialTables) {
      try {
        const result: any = await prisma.$queryRawUnsafe(`SELECT count(*) as count FROM ${table}`);
        tableCounts[table] = Number(result[0].count);
      } catch {
        tableCounts[table] = -1; // Not found
      }
    }

    console.log('RESULT_START');
    console.log(JSON.stringify(tableCounts, null, 2));
    
    const gistIndexes = await prisma.$queryRawUnsafe(`
      SELECT n.nspname as schema, t.relname as table, i.relname as index
      FROM pg_class t
      JOIN pg_index ix ON t.oid = ix.indrelid
      JOIN pg_class i ON i.oid = ix.indexrelid
      JOIN pg_am am ON i.relam = am.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE am.amname = 'gist'
    `);
    console.log('GIST_INDEXES:', JSON.stringify(gistIndexes, null, 2));

    const reqIndexes = await prisma.$queryRawUnsafe(`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'RequirementRecord'
    `);
    console.log('REQ_INDEXES:', JSON.stringify(reqIndexes, null, 2));
    const geomColumns = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name, column_name, udt_name 
      FROM information_schema.columns 
      WHERE udt_name = 'geometry'
    `);
    console.log('GEOM_COLUMNS:', JSON.stringify(geomColumns, null, 2));

    console.log('RESULT_END');

  } catch (error) {
    console.error('ERROR:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
