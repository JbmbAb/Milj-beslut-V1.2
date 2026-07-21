import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Client } = pg;

const STAGING_TABLE = 'lm_staging.flood_risk_area_994bf11c';

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      SELECT pg_cancel_backend(pid)
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND (
          query LIKE '%repair-flood-staging%'
          OR query LIKE '%ST_MakeValid(geom)%${STAGING_TABLE}%'
        );
    `);

    const before = await client.query<{ count: string }>(`
      SELECT count(1) AS count
      FROM ${STAGING_TABLE}
      WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    `);
    console.log(`invalid before: ${before.rows[0]?.count ?? '0'}`);

    await client.query(`
      UPDATE ${STAGING_TABLE}
      SET geom = ST_Buffer(geom, 0)
      WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    `);

    const afterBuffer = await client.query<{ count: string }>(`
      SELECT count(1) AS count
      FROM ${STAGING_TABLE}
      WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    `);
    console.log(`invalid after ST_Buffer(0): ${afterBuffer.rows[0]?.count ?? '0'}`);

    if (Number(afterBuffer.rows[0]?.count ?? 0) > 0) {
      await client.query(`
        UPDATE ${STAGING_TABLE}
        SET geom = ST_MakeValid(geom)
        WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
      `);
    }

    const after = await client.query<{ count: string }>(`
      SELECT count(1) AS count
      FROM ${STAGING_TABLE}
      WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
    `);
    console.log(`invalid after final: ${after.rows[0]?.count ?? '0'}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
