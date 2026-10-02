/**
 * U30-B3 -- retention backfill for bound spatial dataset versions (PRES-05, R1).
 *
 * Thin CLI over packages/spatial-provider-postgis/src/SpatialDatasetRetention.ts
 * (backfillSpatialDatasetRetention). For every SUCCESS version of each target it finds the retained
 * relation (lm_staging.<table>_<hash8>), computes the pg-jsonb-row-sha256-set-v1 digest, requires
 * retained = live for the CURRENT version, and writes/verifies the SPATIAL_DATASET_RETENTION_RECORD
 * in the durable Mimers CAS.
 *
 *   - Database: READ ONLY. The pool runs every statement with default_transaction_read_only=on and
 *     the SQL port refuses any non-query statement. A missing retained relation is reported
 *     (NOT_RETAINED_RELATION_MISSING), never created here.
 *   - CAS: written only with --execute (MIMERS_ROOT required, fail-closed). Without --execute the CAS
 *     is not opened at all (plan: WOULD_RECORD).
 *   - No env file is loaded: DATABASE_URL and MIMERS_ROOT must be given explicitly.
 *
 * OPS STEP -- NOT TO BE RUN WITHOUT THE OWNER'S GO: the digests read every row of the five LU layers
 * and both versions of env.registerenhetsomradesytor (~4.4 M rows, expected > 5 minutes) and the
 * --execute run writes to the durable CAS.
 *
 *   DATABASE_URL=postgresql://... MIMERS_ROOT=D:/mimer-demo/cas \
 *     npx tsx scripts/ops/retain-spatial-dataset-versions.ts [--target env.sgu_well ...] [--execute]
 *
 * One JSON line per version on stdout; exit 1 if any version is DIGEST_MISMATCH or FAILED.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { SPATIAL_LAYER_REGISTRY } from '../../packages/spatial-provider-postgis/src/SpatialLayerRegistry';
import {
  backfillSpatialDatasetRetention,
  parseQualifiedTable,
  type BackfillVersionResult,
  type QualifiedTable,
  type SqlPort,
} from '../../packages/spatial-provider-postgis/src/SpatialDatasetRetention';

/** The five LU v1 layers (SpatialLayerRegistry) plus the property root's source table. */
export const DEFAULT_RETENTION_TARGETS: readonly string[] = Object.freeze([
  ...Object.values(SPATIAL_LAYER_REGISTRY).map((binding) => binding.table),
  'env.registerenhetsomradesytor',
]);

export function parseRetentionCliArgs(argv: readonly string[]): { targets: QualifiedTable[]; execute: boolean } {
  const targets: string[] = [];
  let execute = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--execute') execute = true;
    else if (arg === '--target') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('RETENTION_CLI_REJECTED: --target needs schema.table');
      targets.push(value);
      i += 1;
    } else {
      throw new Error(`RETENTION_CLI_REJECTED: unknown argument "${arg}"`);
    }
  }
  const chosen = targets.length > 0 ? targets : [...DEFAULT_RETENTION_TARGETS];
  return { targets: chosen.map((t) => parseQualifiedTable(t)), execute };
}

/** Query-only SQL port: any statement through `execute` is refused (the backfill never issues one). */
export function createReadOnlySqlPort(pool: Pick<Pool, 'query'>): SqlPort {
  return {
    query: async <T,>(sql: string, params: readonly unknown[] = []) => {
      const result = await pool.query(sql, params as unknown[]);
      return { rows: result.rows as T[] };
    },
    execute: async (sql: string) => {
      throw new Error(`RETENTION_CLI_READ_ONLY: refusing to execute a statement against the database (${sql.slice(0, 60)})`);
    },
  };
}

async function main(): Promise<void> {
  const { targets, execute } = parseRetentionCliArgs(process.argv.slice(2));
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error('RETENTION_CLI_REJECTED: DATABASE_URL must be set explicitly (no env file is loaded)');

  let repo = null;
  if (execute) {
    const { MimersIntegration } = await import('../../packages/mps-runtime/src/mimers/MimersIntegration');
    repo = (await MimersIntegration.create({ env: { ...process.env, MIMERS_REQUIRED: '1' }, forceMimers: true })).artifactRepository;
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    application_name: 'retain-spatial-dataset-versions',
    options: '-c default_transaction_read_only=on -c statement_timeout=0 -c TimeZone=UTC',
  });
  try {
    const results: BackfillVersionResult[] = await backfillSpatialDatasetRetention({
      db: createReadOnlySqlPort(pool),
      repo,
      targets,
      execute,
      onResult: (result) => console.log(JSON.stringify(result)),
    });
    const counts = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    console.error(`retain-spatial-dataset-versions: ${execute ? 'EXECUTE' : 'PLAN'} ${JSON.stringify(counts)}`);
    if (results.some((r) => r.status === 'DIGEST_MISMATCH' || r.status === 'FAILED')) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
