import { execSync } from 'child_process';
import pkg from 'pg';
import { admitDisposableGisTestDatabase } from './disposableGisTestDatabase';
import { applyGisTestStubs, ensureTestAdminUser } from './seedGisStubs';
const { Client } = pkg;

// DB-0-SAFETY: no dotenv.config() here either. This globalSetup drops six schemas below,
// so it is a destructive path in its own right and resolves its target the same guarded way.
// It runs before tests/setup/env.ts, which is a setupFile and therefore cannot protect it.

/** PostGIS/systemtabeller som inte ska trunceras mellan testkörningar. */
const TRUNCATE_EXCLUDE = new Set(['_prisma_migrations', 'spatial_ref_sys']);

export default async () => {
  // DB-0-SAFETY: admission must succeed before prisma is imported or any client is connected.
  const admitted = admitDisposableGisTestDatabase();

  console.log('Setting up test database...');
  const { prisma } = await import('../../server/db/prisma');

  // Pre-clean public schema to avoid Prisma P3005 (database not empty) error
  const preClient = new Client({
    connectionString: admitted.databaseUrl,
    ssl: false,
  });
  await preClient.connect();
  try {
    const publicTables = await preClient.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `);
    for (const row of publicTables.rows) {
      if (row.tablename !== 'spatial_ref_sys') {
        await preClient.query(`DROP TABLE IF EXISTS "public"."${row.tablename}" CASCADE`);
      }
    }
    // Also drop any public types/enums
    const publicTypes = await preClient.query(`
      SELECT typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype = 'e'
    `);
    for (const row of publicTypes.rows) {
      await preClient.query(`DROP TYPE IF EXISTS "public"."${row.typname}" CASCADE`);
    }
    // Also drop other Prisma schemas to prevent P3005 on migrate deploy
    await preClient.query('DROP SCHEMA IF EXISTS "env" CASCADE');
    await preClient.query('DROP SCHEMA IF EXISTS "core" CASCADE');
    await preClient.query('DROP SCHEMA IF EXISTS "topo10" CASCADE');
    await preClient.query('DROP SCHEMA IF EXISTS "climate" CASCADE');
    await preClient.query('DROP SCHEMA IF EXISTS "lm_staging" CASCADE');
    await preClient.query('DROP SCHEMA IF EXISTS "hydro" CASCADE');
    console.log(
      'Pre-cleaned public, env, core, topo10, climate, lm_staging, hydro schemas in test database.',
    );
  } catch (err) {
    console.warn('Failed to pre-clean public schema in test database:', err);
  } finally {
    await preClient.end();
  }

  // 1. Ensure schema via migrate deploy (test DB only — avoids destructive db push/reset)
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });

  // 2. Clean data from all tables managed by Prisma
  const tableNames = await prisma.$queryRaw<
    Array<{ tablename: string }>
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;

  const tablesToTruncate = tableNames
    .map(({ tablename }) => tablename)
    .filter((name) => !TRUNCATE_EXCLUDE.has(name));

  if (tablesToTruncate.length > 0) {
    try {
      const truncateQuery = `TRUNCATE TABLE ${tablesToTruncate
        .map((name) => `"public"."${name}"`)
        .join(', ')} RESTART IDENTITY CASCADE;`;
      await prisma.$executeRawUnsafe(truncateQuery);
      console.log('Successfully truncated Prisma-managed tables.');
    } catch (error) {
      console.error('Error truncating tables:', error);
      console.warn('Truncate failed; continuing without migrate reset (AI-safe).');
    }
  }

  await applyGisTestStubs();

  await ensureTestAdminUser();
  console.log('Test database is ready.');
};
