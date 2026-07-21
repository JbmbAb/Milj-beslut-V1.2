/** Snabb status för pågående core.property_unit-sync. */
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const rel = await pool.query(`
      SELECT c.relkind FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='core' AND c.relname='property_unit'
    `);

    const counts = await pool.query(`
      SELECT
        (SELECT count(*)::bigint FROM env.registerenhetsomradesytor) AS env_n,
        (SELECT count(*)::bigint FROM core.property_unit) AS core_n,
        (SELECT count(*)::bigint FROM core.property_unit WHERE source_dataset='lm_fastighetsytor') AS batch_a,
        (SELECT count(*)::bigint FROM core.property_unit WHERE source_dataset='lm_fastighetsytor_merged') AS batch_b
    `);

    const activity = await pool.query(`
      SELECT pid, state, wait_event_type, wait_event,
             now() - query_start AS age,
             left(query, 160) AS query
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state <> 'idle'
      ORDER BY query_start
    `);

    console.log('core.property_unit:', rel.rows[0]?.relkind === 'r' ? 'TABLE' : rel.rows[0]?.relkind);
    console.log('env rows:    ', counts.rows[0].env_n);
    console.log('core rows:   ', counts.rows[0].core_n);
    console.log('  Batch A:   ', counts.rows[0].batch_a);
    console.log('  Batch B:   ', counts.rows[0].batch_b);
    console.log('active queries:', activity.rowCount);
    for (const row of activity.rows) {
      console.log(`  pid=${row.pid} age=${JSON.stringify(row.age)} ${row.query}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
