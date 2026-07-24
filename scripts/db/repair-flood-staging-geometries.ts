import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Client } = pg;

const STAGING_TABLE = 'lm_staging.flood_risk_area_994bf11c';

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      `SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE query LIKE '%ST_MakeValid(geom)%' AND pid <> pg_backend_pid()`,
    );

    const invalid = await client.query<{ id: number }>(`
      SELECT id FROM ${STAGING_TABLE}
      WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)
      ORDER BY id;
    `);

    console.log(`repairing ${invalid.rows.length} geometries...`);
    let fixed = 0;
    for (const row of invalid.rows) {
      await client.query(`UPDATE ${STAGING_TABLE} SET geom = ST_MakeValid(geom) WHERE id = $1`, [row.id]);
      fixed += 1;
      if (fixed % 10 === 0 || fixed === invalid.rows.length) {
        console.log(`  ${fixed}/${invalid.rows.length}`);
      }
    }

    const remaining = await client.query<{ count: string }>(`
      SELECT count(1) AS count
      FROM ${STAGING_TABLE}
      WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    `);
    console.log(`remaining invalid: ${remaining.rows[0]?.count ?? '0'}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
