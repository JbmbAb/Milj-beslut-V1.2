import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL saknas i .env');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query<{ pid: number; cancelled: boolean }>(`
      SELECT pid, pg_cancel_backend(pid) AS cancelled
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND query ILIKE '%CREATE MATERIALIZED VIEW analytisk_miljo.viss_svar_kombinerad%'
        AND pid <> pg_backend_pid();
    `);
    console.log(JSON.stringify(result.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
