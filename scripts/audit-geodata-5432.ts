import { Client } from 'pg';

async function main() {
  // Test common ports and typical dev credentials
  const configurations = [
    { port: 5432, user: 'postgres', database: 'postgres', password: 'password' },
    { port: 5432, user: 'miljobeslut', database: 'miljobeslut', password: 'password' },
    { port: 5432, user: 'postgres', database: 'miljobeslut', password: 'password' }
  ];

  console.log('--- Geodata Table Audit (Port 5432) ---');
  
  for (const config of configurations) {
    const client = new Client({
      host: 'localhost',
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database
    });

    try {
      await client.connect();
      console.log(`\n✅ Ansluten till port ${config.port} (${config.user}@${config.database})`);
      
      const tables = [
          'core.property_unit',
          'env.marktacke',
          'env.protected_area',
          'env.sgu_soil_type_25k_100k',
          'topo10.byggnad',
          'topo10.mark',
          'topo10.vag',
          'topo10.vatten'
      ];

      for (const table of tables) {
          try {
              const res = await client.query(`SELECT count(*) as c FROM ${table}`);
              console.log(`${table.padEnd(30)}: ${res.rows[0].c} rader`);
          } catch (e) {
              // Silently ignore if table doesn't exist
          }
      }
      await client.end();
      // If one works, we can stop
      return;
    } catch (err) {
      // console.log(`❌ Kunde inte ansluta till ${config.user}@${config.database}: ${err.message}`);
    }
  }
  
  console.log('\n❌ Hittade ingen aktiv databas på port 5432 med standarduppgifter.');
}

main();
