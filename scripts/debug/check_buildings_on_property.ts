import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  
  const query = `
    SELECT b.objektidentitet, b.objekttyp, ST_AsText(b.geom) as wkt
    FROM topo10.byggnad b
    JOIN env.registerenhetsomradesytor f ON ST_Intersects(b.geom, f.geom)
    WHERE 
      f.kommunnamn = 'ORSA' AND 
      f.trakt = 'STACKMORA' AND 
      f.block = '3' AND 
      f.enhet = '12'
  `;
  
  const res = await client.query(query);
  console.log('Buildings found on Orsa Stackmora 3:12:', res.rows);
  
  await client.end();
}
main();
