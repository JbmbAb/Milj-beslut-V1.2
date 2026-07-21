import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('--- Geodata Table Audit (Direct PG) ---');
  try {
    const res = await client.query(`
      SELECT 
        schemaname, 
        tablename, 
        (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, false, '')))[1]::text::int as row_count 
      FROM pg_tables 
      WHERE schemaname IN ('topo10', 'env', 'core', 'hydro') 
      ORDER BY schemaname, tablename
    `);
    
    console.table(res.rows);
  } catch (err) {
    console.error('Kunde inte hämta tabellinfo:', err);
  } finally {
    await client.end();
  }
}

main();
