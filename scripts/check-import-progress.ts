import { Client } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function check() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const tables = [
    { name: 'env.sgu_fastmark_stabilitet', label: 'SGU Fastmark' },
    { name: 'public.env_registerenhetsomradesytor', label: 'LM Fastighetsytor' },
    { name: 'public.env_registerenhetsomradeslinjer', label: 'LM Fastighetslinjer' },
    { name: 'core.lm_byggnad', label: 'LM Byggnader' },
  ];

  console.log('\n--- Aktuell Status ---');
  for (const t of tables) {
    try {
      const res = await client.query(`SELECT count(*) FROM ${t.name}`);
      console.log(`${t.label}: ${res.rows[0].count} rader`);
    } catch {
      console.log(`${t.label}: Tabell ej skapad ännu`);
    }
  }
  await client.end();
}
check();
