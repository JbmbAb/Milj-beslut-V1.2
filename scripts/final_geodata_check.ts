import { Client } from 'pg';

async function main() {
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'miljobeslut',
    password: 'password',
    database: 'miljobeslut'
  });

  console.log('--- Slutgiltig Geodata-kontroll (Port 5432) ---');
  
  try {
    await client.connect();
    console.log('✅ Ansluten till databasen på port 5432.');
    
    const tables = [
        'core.property_unit',
        'env.sgu_soil_type',
        'env.protected_area',
        'env.water_protection_area',
        'topo10.mark',
        'topo10.vag',
        'topo10.vatten',
        'culture.monument'
    ];

    for (const table of tables) {
        try {
            const res = await client.query(`SELECT count(*) as c FROM ${table}`);
            console.log(`${table.padEnd(30)}: ${res.rows[0].c} rader`);
            
            if (parseInt(res.rows[0].c) > 0) {
              const sample = await client.query(`SELECT * FROM ${table} LIMIT 1`);
              console.log(`   [EXEMPEL]: ${JSON.stringify(sample.rows[0]).substring(0, 80)}...`);
            }
        } catch (e) {
            console.log(`${table.padEnd(30)}: TABELL SAKNAS ELLER TOM`);
        }
    }
  } catch (err) {
    console.error('❌ Kunde inte ansluta till databasen:', err.message);
  } finally {
    await client.end();
  }
}

main();
