import { Client } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

// Load env from the root based on CWD (which is project root)
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

async function check() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('No DATABASE_URL found in env!');
    process.exit(1);
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
    
    // Check estimated row counts for the lm schema
    const res = await client.query(`
      SELECT tablename, reltuples::bigint AS estimated_rows 
      FROM pg_tables t 
      JOIN pg_class c ON c.relname = t.tablename 
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname 
      WHERE t.schemaname = 'lm' 
      ORDER BY t.tablename;
    `);
    
    console.log('=== CURRENT LM SCHEMA STATUS ===');
    console.table(res.rows);
    
    await client.end();
  } catch (err) {
    console.error('Failed to query database:', err);
  }
}
check();
