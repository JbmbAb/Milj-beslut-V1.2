import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

async function run() {
  await client.connect();
  const res = await client.query(`SELECT schema_name FROM information_schema.schemata;`);
  console.log('Schemas:', res.rows.map(r => r.schema_name).join(', '));
  
  const tables = await client.query(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_schema NOT IN ('information_schema', 'pg_catalog');
  `);
  console.log('Active tables:', tables.rows.map(r => `${r.table_schema}.${r.table_name}`).join(', '));
  await client.end();
}
run();
