import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function test() {
  console.log('Using DATABASE_URL:', process.env.DATABASE_URL);
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });
  try {
    await client.connect();
    console.log('Connected successfully');
    const res = await client.query('SELECT version()');
    console.log('Version:', res.rows[0].version);
    await client.end();
  } catch (err) {
    console.error('Connection failed:', err);
  }
}
test();
