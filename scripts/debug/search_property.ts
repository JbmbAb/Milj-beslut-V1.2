import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  // 1. Get columns
  const cols = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'env' AND table_name = 'registerenhetsomradesytor'");
  console.log('Columns:', cols.rows.map(r => r.column_name));

  // 2. Target search for Orsa Stackmora 3:12
  const query = `
    SELECT fid, objektidentitet, registerenhetsreferens, objekttyp, kommunnamn, trakt, block, enhet, etikett, ST_AsText(geom) as wkt
    FROM env.registerenhetsomradesytor 
    WHERE 
      kommunnamn = 'ORSA' AND 
      trakt = 'STACKMORA' AND 
      block = '3' AND 
      enhet = '12'
    LIMIT 5
  `;
  
  const res = await client.query(query);
  console.log('Search Results:', res.rows);
  
  await client.end();
}
main();
