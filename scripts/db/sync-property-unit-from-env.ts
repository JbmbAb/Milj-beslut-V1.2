/**
 * Materialiserar core.property_unit från env.registerenhetsomradesytor.
 *
 * Batch A — alla registerenhetsområden 1:1 (etikett inkl. >1, >2, …), per län
 * Batch B — sammanslagna moderbeteckningar (ST_Union), per län
 *
 * npm run db:sync:property-unit -- --execute
 * npm run db:sync:property-unit -- --execute --phase individual
 * npm run db:sync:property-unit -- --execute --phase merged
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import type { PrismaClient } from '@prisma/client';
import { PrismaClient as DefaultPrismaClient } from '@prisma/client';

dotenv.config();

export type SyncPhase = 'all' | 'individual' | 'merged';

export interface SyncPropertyUnitOptions {
  execute?: boolean;
  spotChecks?: string[];
  phase?: SyncPhase;
  onProgress?: (message: string) => void;
}

export interface SyncPropertyUnitResult {
  mode: 'plan' | 'executed';
  phase: SyncPhase;
  envRows: number;
  coreRowsBefore: number;
  coreRowsAfter: number;
  individualRows: number;
  mergedRows: number;
  durationMs: number;
  spotChecks: Array<{ designation: string; found: boolean; matchType?: 'exact' | 'merged' | 'part' }>;
}

const DEFAULT_SPOT_CHECKS = [
  'ORSA STACKMORA 3:12',
  'ORSA STACKMORA 3:12>1',
  'ORSA STACKMORA 3:12>2',
  'ORSA STACKMORA 3:12>3',
];

const CORE_DDL_PATH = resolve(process.cwd(), 'prisma', 'spatial', '004_property_unit_core.sql');

async function ensurePropertyUnitSchema(pool: Pool, recreate: boolean): Promise<void> {
  if (recreate) {
    const ddl = readFileSync(CORE_DDL_PATH, 'utf8');
    await pool.query(ddl);
    return;
  }

  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS core;

    CREATE OR REPLACE FUNCTION core.normalize_designation(input text)
    RETURNS text
    LANGUAGE plpgsql
    IMMUTABLE
    AS $function$
    BEGIN
      RETURN UPPER(REGEXP_REPLACE(UNACCENT(input), '[^a-zA-Z0-9:]', '', 'g'));
    END;
    $function$;

    CREATE TABLE IF NOT EXISTS core.property_unit (
      id SERIAL PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      designation TEXT NOT NULL,
      designation_norm TEXT NOT NULL,
      municipality_code TEXT,
      municipality_name TEXT,
      county_code TEXT,
      source_dataset TEXT NOT NULL,
      source_updated_at TIMESTAMPTZ,
      raw_properties JSONB,
      geom geometry(MultiPolygon, 3006)
    );

    CREATE INDEX IF NOT EXISTS property_unit_designation_norm_idx
      ON core.property_unit (designation_norm);
    CREATE INDEX IF NOT EXISTS property_unit_designation_norm_trgm_idx
      ON core.property_unit USING gin (designation_norm gin_trgm_ops);
    CREATE INDEX IF NOT EXISTS property_unit_geom_gist_idx
      ON core.property_unit USING gist (geom);
  `);
}

const INDIVIDUAL_INSERT_SQL = `
  INSERT INTO core.property_unit (
    source_key,
    designation,
    designation_norm,
    municipality_code,
    municipality_name,
    county_code,
    source_dataset,
    source_updated_at,
    raw_properties,
    geom
  )
  SELECT
    r.objektidentitet::text AS source_key,
    upper(trim(concat(r.kommunnamn, ' ', r.trakt, ' ', r.etikett))) AS designation,
    core.normalize_designation(upper(trim(concat(r.kommunnamn, ' ', r.trakt, ' ', r.etikett)))) AS designation_norm,
    r.kommunkod::text AS municipality_code,
    r.kommunnamn::text AS municipality_name,
    r.lanskod::text AS county_code,
    'lm_fastighetsytor'::text AS source_dataset,
    r.senastandrad AS source_updated_at,
    to_jsonb(r.*) - 'geom' AS raw_properties,
    r.geom
  FROM env.registerenhetsomradesytor r
  WHERE r.lanskod::int = $1::int;
`;

const MERGED_INSERT_SQL = `
  INSERT INTO core.property_unit (
    source_key,
    designation,
    designation_norm,
    municipality_code,
    municipality_name,
    county_code,
    source_dataset,
    source_updated_at,
    raw_properties,
    geom
  )
  SELECT
    ('merged:' || sub.designation_norm) AS source_key,
    min(sub.designation_base) AS designation,
    sub.designation_norm,
    min(sub.municipality_code) AS municipality_code,
    min(sub.municipality_name) AS municipality_name,
    min(sub.county_code) AS county_code,
    'lm_fastighetsytor_merged'::text AS source_dataset,
    max(sub.source_updated_at) AS source_updated_at,
    jsonb_agg(sub.part_props) AS raw_properties,
    st_multi(st_union(sub.geom)) AS geom
  FROM (
    SELECT
      regexp_replace(
        upper(trim(concat(r.kommunnamn, ' ', r.trakt, ' ', r.etikett))),
        '>.*$',
        ''
      ) AS designation_base,
      core.normalize_designation(
        regexp_replace(
          upper(trim(concat(r.kommunnamn, ' ', r.trakt, ' ', r.etikett))),
          '>.*$',
          ''
        )
      ) AS designation_norm,
      r.kommunkod::text AS municipality_code,
      r.kommunnamn::text AS municipality_name,
      r.lanskod::text AS county_code,
      r.senastandrad AS source_updated_at,
      to_jsonb(r.*) - 'geom' AS part_props,
      r.geom
    FROM env.registerenhetsomradesytor r
    WHERE r.etikett LIKE '%>%' AND r.lanskod::int = $1::int
  ) sub
  GROUP BY sub.designation_norm
  ON CONFLICT (source_key) DO UPDATE SET
    geom = ST_Multi(ST_Union(core.property_unit.geom, EXCLUDED.geom)),
    raw_properties = COALESCE(core.property_unit.raw_properties, '[]'::jsonb) || EXCLUDED.raw_properties,
    source_updated_at = GREATEST(core.property_unit.source_updated_at, EXCLUDED.source_updated_at);
`;

async function countRows(prisma: PrismaClient, qualified: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT count(*)::bigint AS n FROM ${qualified}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function relKind(prisma: PrismaClient): Promise<'table' | 'view' | 'missing'> {
  const rows = await prisma.$queryRaw<Array<{ relkind: string }>>`
    SELECT c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'core' AND c.relname = 'property_unit'
  `;
  const kind = rows[0]?.relkind;
  if (kind === 'r') return 'table';
  if (kind === 'v') return 'view';
  return 'missing';
}

async function distinctLans(prisma: PrismaClient): Promise<number[]> {
  const rows = await prisma.$queryRaw<Array<{ lan: number }>>`
    SELECT DISTINCT lanskod::int AS lan
    FROM env.registerenhetsomradesytor
    WHERE lanskod IS NOT NULL
    ORDER BY lan
  `;
  return rows.map((r) => r.lan);
}

async function runSpotChecks(
  prisma: PrismaClient,
  designations: string[],
): Promise<SyncPropertyUnitResult['spotChecks']> {
  const results: SyncPropertyUnitResult['spotChecks'] = [];

  for (const designation of designations) {
    const rows = await prisma.$queryRaw<
      Array<{ designation: string; source_key: string; source_dataset: string }>
    >`
      WITH q AS (SELECT core.normalize_designation(${designation}) AS designation_norm)
      SELECT pu.designation, pu.source_key, pu.source_dataset
      FROM core.property_unit pu, q
      WHERE pu.designation_norm = q.designation_norm
      LIMIT 1
    `;
    const hit = rows[0];
    results.push({
      designation,
      found: Boolean(hit),
      matchType:
        hit?.source_dataset === 'lm_fastighetsytor_merged'
          ? 'merged'
          : hit?.source_dataset === 'lm_fastighetsytor'
            ? 'part'
            : hit
              ? 'exact'
              : undefined,
    });
  }

  return results;
}

async function insertByLanBatches(
  pool: Pool,
  sql: string,
  lans: number[],
  label: string,
  log: (message: string) => void,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < lans.length; i++) {
    const lan = lans[i];
    const started = Date.now();
    const result = await pool.query(sql, [lan]);
    const inserted = result.rowCount ?? 0;
    total += inserted;
    log(
      `[${label}] län ${String(lan).padStart(2, '0')} (${i + 1}/${lans.length}): +${inserted.toLocaleString('sv-SE')} rader, totalt ${total.toLocaleString('sv-SE')} (${((Date.now() - started) / 1000).toFixed(1)}s)`,
    );
  }
  return total;
}

export async function syncPropertyUnitFromEnv(
  prisma: PrismaClient,
  options: SyncPropertyUnitOptions = {},
): Promise<SyncPropertyUnitResult> {
  const execute = options.execute ?? false;
  const spotChecks = options.spotChecks ?? DEFAULT_SPOT_CHECKS;
  const phase: SyncPhase = options.phase ?? 'all';
  const log = options.onProgress ?? ((message: string) => console.log(message));
  const started = Date.now();

  const envRows = await countRows(prisma, 'env.registerenhetsomradesytor');
  if (envRows === 0) {
    throw new Error('env.registerenhetsomradesytor is empty — run Librarian promote first.');
  }

  const kindBefore = await relKind(prisma);
  const coreRowsBefore = kindBefore === 'missing' ? 0 : await countRows(prisma, 'core.property_unit');

  if (!execute) {
    const splitParts = await countRows(prisma, "env.registerenhetsomradesytor WHERE etikett LIKE '%>%'");
    return {
      mode: 'plan',
      phase,
      envRows,
      coreRowsBefore,
      coreRowsAfter: envRows + splitParts,
      individualRows: envRows,
      mergedRows: splitParts,
      durationMs: Date.now() - started,
      spotChecks: spotChecks.map((designation) => ({ designation, found: false })),
    };
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const recreateTable = phase === 'all' || phase === 'individual';
  let individualInserted = 0;
  let mergedInserted = 0;

  try {
    await ensurePropertyUnitSchema(pool, recreateTable);

    if (phase === 'all' || phase === 'individual') {
      log('[setup] TRUNCATE core.property_unit');
      await pool.query('TRUNCATE core.property_unit RESTART IDENTITY;');
    }

    const lans = await distinctLans(prisma);

    if (phase === 'all' || phase === 'individual') {
      log(
        `[Batch A] Individual 1:1 sync — ${lans.length} län, ~${envRows.toLocaleString('sv-SE')} källrader`,
      );
      individualInserted = await insertByLanBatches(pool, INDIVIDUAL_INSERT_SQL, lans, 'Batch A', log);
      log(`[Batch A] Klar: ${individualInserted.toLocaleString('sv-SE')} rader`);
    }

    if (phase === 'all' || phase === 'merged') {
      if (phase === 'merged') {
        log('[Batch B] Rensar tidigare merged-rader');
        await pool.query(`DELETE FROM core.property_unit WHERE source_dataset = 'lm_fastighetsytor_merged';`);
      }
      log(`[Batch B] Merged moderbeteckningar (ST_Union) — ${lans.length} län`);
      mergedInserted = await insertByLanBatches(pool, MERGED_INSERT_SQL, lans, 'Batch B', log);
      log(`[Batch B] Klar: ${mergedInserted.toLocaleString('sv-SE')} rader`);
    }

    log('[finalize] ANALYZE core.property_unit');
    await pool.query('ANALYZE core.property_unit;');
  } finally {
    await pool.end();
  }

  const coreRowsAfter = await countRows(prisma, 'core.property_unit');
  const datasetCounts = await prisma.$queryRaw<Array<{ source_dataset: string; n: bigint }>>`
    SELECT source_dataset, count(*)::bigint AS n
    FROM core.property_unit
    GROUP BY source_dataset
  `;
  const individualRows = Number(
    datasetCounts.find((r) => r.source_dataset === 'lm_fastighetsytor')?.n ?? individualInserted,
  );
  const mergedRows = Number(
    datasetCounts.find((r) => r.source_dataset === 'lm_fastighetsytor_merged')?.n ?? mergedInserted,
  );
  const spotCheckResults = await runSpotChecks(prisma, spotChecks);

  return {
    mode: 'executed',
    phase,
    envRows,
    coreRowsBefore,
    coreRowsAfter,
    individualRows,
    mergedRows,
    durationMs: Date.now() - started,
    spotChecks: spotCheckResults,
  };
}

function formatResult(result: SyncPropertyUnitResult): void {
  console.log(`\n=== core.property_unit sync (${result.mode}, phase=${result.phase}) ===`);
  console.log(`env.registerenhetsomradesytor: ${result.envRows.toLocaleString('sv-SE')} rows`);
  console.log(`core.property_unit before:      ${result.coreRowsBefore.toLocaleString('sv-SE')} rows`);
  if (result.mode === 'executed') {
    console.log(`  Batch A (individual):         ${result.individualRows.toLocaleString('sv-SE')}`);
    console.log(`  Batch B (merged):             ${result.mergedRows.toLocaleString('sv-SE')}`);
    console.log(`core.property_unit after:       ${result.coreRowsAfter.toLocaleString('sv-SE')} rows`);
    console.log(`duration:                     ${(result.durationMs / 1000).toFixed(1)}s`);
    console.log('\nSpot checks:');
    for (const check of result.spotChecks) {
      const icon = check.found ? 'OK' : 'MISS';
      const kind = check.matchType ? ` (${check.matchType})` : '';
      console.log(`  [${icon}] ${check.designation}${kind}`);
    }
  } else {
    console.log(`core.property_unit after (est): ~${result.coreRowsAfter.toLocaleString('sv-SE')} rows`);
    console.log(`  Batch A: ~${result.individualRows.toLocaleString('sv-SE')}`);
    console.log(`  Batch B: ~${result.mergedRows.toLocaleString('sv-SE')}`);
    console.log('\nDry-run — pass --execute to materialize.');
  }
}

function parsePhase(args: string[]): SyncPhase {
  const idx = args.indexOf('--phase');
  if (idx === -1) return 'all';
  const value = args[idx + 1];
  if (value === 'individual' || value === 'merged' || value === 'all') return value;
  throw new Error(`Invalid --phase ${value}. Use all|individual|merged`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const execute = args.includes('--execute');
  const phase = parsePhase(args);
  const spotChecks = args.includes('--spot-check')
    ? args[args.indexOf('--spot-check') + 1]
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const prisma = new DefaultPrismaClient();
  try {
    const result = await syncPropertyUnitFromEnv(prisma, { execute, spotChecks, phase });
    formatResult(result);

    if (execute) {
      const failed = result.spotChecks.filter((c) => !c.found);
      if (failed.length > 0) {
        console.error('\nSpot-check failures:', failed.map((f) => f.designation).join(', '));
        process.exitCode = 1;
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.includes('sync-property-unit-from-env')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
