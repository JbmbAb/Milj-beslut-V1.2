import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Client } = pg;

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const summary = await client.query(`
      SELECT
        return_period,
        count(1)::int AS rows,
        count(1) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::int AS invalid_geom
      FROM lm_staging.flood_risk_area_994bf11c
      GROUP BY return_period
      ORDER BY return_period;
    `);
    console.log(JSON.stringify(summary.rows, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
