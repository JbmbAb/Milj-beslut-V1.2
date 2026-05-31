import { Client } from 'pg';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('--- Geodata Table Audit (Row Count Only) ---');
  try {
    const tables = [
      'core.property_unit',
      'env.marktacke',
      'env.protected_area',
      'env.sgu_soil_type_25k_100k',
      'topo10.byggnad',
      'topo10.mark',
      'topo10.vag',
      'topo10.vatten',
    ];

    for (const table of tables) {
      try {
        const res = await client.query(`SELECT count(*) as c FROM ${table}`);
        console.log(`${table.padEnd(30)}: ${res.rows[0].c} rader`);
      } catch {
        console.log(`${table.padEnd(30)}: TABELL SAKNAS`);
      }
    }
  } catch (err) {
    console.error('Kunde inte hämta tabellinfo:', err);
  } finally {
    await client.end();
  }
}

main();
