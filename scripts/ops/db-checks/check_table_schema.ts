import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const arg = process.argv[2];
  const [schema, table] = arg.split('.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = '${schema}' AND table_name = '${table}';
  `);
  console.table(res.rows);
  await client.end();
}
run();
