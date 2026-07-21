import dotenv from 'dotenv';
dotenv.config();
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  console.log('=== Checking PostgreSQL Server Databases ===\n');
  try {
    const dbs = await p.$queryRawUnsafe<any[]>(
      `SELECT datname FROM pg_database WHERE datistemplate = false`
    );
    console.log('Databases:', dbs.map(d => d.datname).join(', '));

    console.log('\n=== Checking All Schemas in Current Database ===\n');
    const schemas = await p.$queryRawUnsafe<any[]>(`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name NOT IN ('pg_catalog', 'information_schema')
    `);
    console.log('Schemas:', schemas.map(s => s.schema_name).join(', '));

    console.log('\n=== Checking Table Inventory ===\n');
    // Query to list all tables, their row count estimates, and schemas
    const tables = await p.$queryRawUnsafe<any[]>(`
      SELECT 
        table_schema as schema,
        table_name as table,
        (xpath('/row/cnt/text()', xmlforest(c.reltuples::bigint as cnt)))[1]::text::bigint as row_estimate
      FROM information_schema.tables t
      JOIN pg_class c ON c.relname = t.table_name
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        AND table_type = 'BASE TABLE'
      ORDER BY table_schema, table_name;
    `);

    if (tables.length === 0) {
      console.log('No tables found.');
    } else {
      console.log('Schema'.padEnd(12) + 'Table'.padEnd(45) + 'Row Estimate');
      console.log('─'.repeat(72));
      for (const t of tables) {
        console.log(
          String(t.schema).padEnd(12) + 
          String(t.table).padEnd(45) + 
          Number(t.row_estimate ?? 0).toLocaleString('sv-SE')
        );
      }
    }

    console.log('\n=== Checking Exact Row Counts for lm_staging Tables ===\n');
    const lmStagingTables = tables.filter(t => t.schema === 'lm_staging');
    if (lmStagingTables.length === 0) {
      console.log('No tables in lm_staging schema.');
    } else {
      for (const t of lmStagingTables) {
        try {
          const countRes = await p.$queryRawUnsafe<any[]>(
            `SELECT COUNT(*)::bigint as cnt FROM "${t.schema}"."${t.table}"`
          );
          const count = Number(countRes[0]?.cnt ?? 0);
          console.log(`lm_staging.${t.table.padEnd(45)} : ${count.toLocaleString('sv-SE')} rows`);
        } catch (err: any) {
          console.log(`lm_staging.${t.table.padEnd(45)} : ERROR (${err.message.slice(0, 50)})`);
        }
      }
    }
    
    // Check for raster tables specifically
    console.log('\n=== Checking Raster Tables in PostGIS ===\n');
    const rasterTables = await p.$queryRawUnsafe<any[]>(`
      SELECT 
        r_table_schema as schema,
        r_table_name as table,
        srid,
        scale_x,
        scale_y,
        num_bands
      FROM raster_columns;
    `);

    if (rasterTables.length === 0) {
      console.log('No raster tables registered in raster_columns.');
    } else {
      console.log('Schema'.padEnd(12) + 'Table'.padEnd(45) + 'SRID'.padEnd(8) + 'Bands'.padEnd(8) + 'Resolution');
      console.log('─'.repeat(80));
      for (const r of rasterTables) {
        const res = `${Math.abs(Number(r.scale_x))}m x ${Math.abs(Number(r.scale_y))}m`;
        console.log(
          String(r.schema).padEnd(12) + 
          String(r.table).padEnd(45) + 
          String(r.srid).padEnd(8) + 
          String(r.num_bands).padEnd(8) + 
          res
        );
      }
    }
  } catch (e: any) {
    console.error('Error fetching database inventory:', e.message);
  } finally {
    await p.$disconnect();
  }
}

main();
