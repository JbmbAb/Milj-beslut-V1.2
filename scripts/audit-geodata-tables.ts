import { prisma } from '../server/db/prisma';

async function main() {
  console.log('--- Geodata Table Audit ---');
  try {
    const tables: any[] = await prisma.$queryRaw`
      SELECT 
        schemaname, 
        tablename, 
        (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, false, '')))[1]::text::int as row_count 
      FROM pg_tables 
      WHERE schemaname IN ('topo10', 'env', 'core', 'hydro') 
      ORDER BY schemaname, tablename
    `;
    
    if (tables.length === 0) {
      console.log('Inga tabeller hittades i de angivna schemana.');
    } else {
      console.table(tables);
    }
  } catch (err) {
    console.error('Kunde inte hämta tabellinfo:', err);
  }
}

main().catch(console.error).finally(() => process.exit());
