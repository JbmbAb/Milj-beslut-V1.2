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
        relname AS table_name, 
        pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
        pg_total_relation_size(relid) AS size_bytes
    FROM pg_catalog.pg_statio_user_tables 
    ORDER BY pg_total_relation_size(relid) DESC;
  `;

  try {
    const res = await client.query(query);
    console.table(res.rows.map(r => ({
      schema: r.schemaname,
      table: r.table_name,
      size: r.total_size
    })));
    
    const totalBytes = res.rows.reduce((acc, r) => acc + parseInt(r.size_bytes), 0);
    console.log(`\nTotal databasstorlek (användardata): ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  } catch (err) {
    console.error('Kunde inte hämta storleksstatistik:', err);
  } finally {
    await client.end();
  }
}

run();
