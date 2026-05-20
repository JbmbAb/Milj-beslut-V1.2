import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  await client.connect();
  
  const tables = [
    { schema: 'env', table: 'sgu_landslide_feature' },
    { schema: 'stage', table: 'sgu_landslide_feature_raw' },
    { schema: 'env', table: 'sgu_ground_layer' },
    { schema: 'stage', table: 'sgu_ground_layer_raw' }
  ];

  for (const t of tables) {
    const res = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = '${t.schema}' AND table_name = '${t.table}';
    `);
    console.log(`Table: ${t.schema}.${t.table}`);
    console.table(res.rows.map(r => r.column_name));
  }
  
  await client.end();
}

run();
