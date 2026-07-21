import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Client } = pg;

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const prod = await client.query<{ rows: number }>(
      `SELECT count(1)::int AS rows FROM climate.flood_risk_area`,
    ).catch(() => ({ rows: [{ rows: 0 }] }));
    const staging = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'lm_staging' AND table_name LIKE 'flood_risk_area%'
      ORDER BY table_name;
    `);
    const counts: Record<string, number> = {};
    for (const row of staging.rows) {
      const count = await client.query<{ rows: number }>(
        `SELECT count(1)::int AS rows FROM lm_staging.${row.table_name}`,
      );
      counts[row.table_name] = count.rows[0]?.rows ?? 0;
    }
    console.log(JSON.stringify({ prod: prod.rows[0]?.rows ?? 0, staging: counts }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
