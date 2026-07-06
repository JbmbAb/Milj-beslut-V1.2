import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();
const { Client } = pg;

const STAGING_TABLE = 'lm_staging.flood_risk_area_994bf11c';
const BATCH_SIZE = 5;

async function countInvalid(client: pg.Client): Promise<number> {
  const result = await client.query<{ count: string }>(`
    SELECT count(1) AS count
    FROM ${STAGING_TABLE}
    WHERE geom IS NOT NULL AND NOT ST_IsValid(geom);
  `);
  return Number(result.rows[0]?.count ?? 0);
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`
      SELECT pg_cancel_backend(pid)
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND query ILIKE '%${STAGING_TABLE}%'
        AND (
          query ILIKE '%ST_Buffer(geom, 0)%'
          OR query ILIKE '%ST_MakeValid(geom)%'
        );
    `);

    let remaining = await countInvalid(client);
    console.log(`invalid start: ${remaining}`);

    while (remaining > 0) {
      const batch = await client.query<{ id: number }>(`
        SELECT id
        FROM ${STAGING_TABLE}
        WHERE geom IS NOT NULL AND NOT ST_IsValid(geom)
        ORDER BY id
        LIMIT ${BATCH_SIZE};
      `);
      if (batch.rows.length === 0) break;

      for (const row of batch.rows) {
        await client.query(
          `
            UPDATE ${STAGING_TABLE}
            SET geom = ST_Multi(ST_CollectionExtract(ST_Buffer(ST_SnapToGrid(geom, 0.1), 0), 3))
            WHERE id = $1;
          `,
          [row.id],
        );
      }

      remaining = await countInvalid(client);
      console.log(`remaining invalid: ${remaining}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
