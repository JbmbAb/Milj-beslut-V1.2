
import pg from 'pg';
const { Client } = pg;

const connectionString = 'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut';
const client = new Client({ connectionString });

async function checkPostGIS() {
  try {
    await client.connect();
    console.log('Connected to database');
    const res = await client.query('SELECT PostGIS_Full_Version();');
    console.log('PostGIS Version:', res.rows[0].postgis_full_version);
    
    const tables = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';");
    console.log('Tables in public schema:', tables.rows.map(r => r.table_name).join(', '));
    
  } catch (err) {
    console.error('Error connecting to database:', err.message);
  } finally {
    await client.end();
  }
}

checkPostGIS();
