import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const query = `
    SELECT 
        schemaname, 
        relname, 
        n_live_tup AS approx_count 
    FROM 
        pg_stat_user_tables 
    ORDER BY 
        n_live_tup DESC;
  `;
  
  try {
    const res = await client.query(query);
    console.log('Antal rader per tabell (ungefärligt):');
    console.table(res.rows);
    
    const total = res.rows.reduce((acc, row) => acc + parseInt(row.approx_count), 0);
    console.log(`\nTotalt antal rader i användartabeller: ${total}`);
  } catch (err) {
    console.error('Kunde inte hämta statistik:', err);
  } finally {
    await client.end();
  }
}

run();
