import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
async function run() {
  await client.connect();
  const res = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
    ORDER BY table_schema, table_name;
  `);
  res.rows.forEach(r => console.log(`${r.table_schema}.${r.table_name}`));
  await client.end();
}
run();
