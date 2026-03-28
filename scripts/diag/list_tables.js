import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND (table_name LIKE 'sgu_%' OR table_name LIKE 'env_%');
  `);
  console.log('Tables found:', res.rows.map(r => r.table_name).join(', '));
  await client.end();
}

run().catch(console.error);
