import { Pool } from 'pg';

/**
 * Delad PG-pool för rå SQL (t.ex. PostGIS-lager i geodata).
 * Applikations-ORM använder Prisma; denna pool är avsiktligt separat.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});
