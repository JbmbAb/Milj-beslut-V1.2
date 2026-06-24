/**
 * PostGIS import QA helpers for import-librarian-manifest.ts
 *
 * Phase 1: staging spatial QA after ogr2ogr
 * Phase 2: promote row-count audit
 * Phase 3: post-promote maintenance + optional map-layer smoke
 */
import type { PrismaClient } from '@prisma/client';
import { ALL_DATASET_MAP_LAYERS } from '../../server/datasources/platformMapLayerRegistry';

export const EXPECTED_IMPORT_SRID = 3006;
const DEFAULT_SMOKE_BBOX = '17.55,59.82,17.75,59.92';
/** Minimum rows before BRIN is worth building (small tables: GiST only). */
export const DEFAULT_MIN_ROWS_FOR_BRIN = 100_000;
/** Passed to ogr2ogr/libpq via PGOPTIONS (separate DB session from Prisma). */
export const OGR2OGR_PGOPTIONS =
  '-c maintenance_work_mem=4GB -c work_mem=1GB -c synchronous_commit=off';

const BRIN_COLUMN_CANDIDATES = ['ogc_fid', 'fid', 'id', 'gid'] as const;

export interface StagingQaResult {
  totalRows: number;
  nullGeomRows: number;
  invalidGeomRows: number;
  srid: number | null;
}

export interface PromoteAuditResult {
  stagingRows: number;
  prodRowsBefore: number;
  prodRowsAfter: number;
}

export function assertStagingQaPasses(qa: StagingQaResult, expectedSrid = EXPECTED_IMPORT_SRID): void {
  if (qa.totalRows === 0) {
    throw new Error('Staging QA failed: zero rows imported');
  }
  if (qa.srid !== expectedSrid) {
    throw new Error(`Staging QA failed: expected SRID ${expectedSrid}, got ${qa.srid ?? 'null'}`);
  }
  if (qa.invalidGeomRows > 0) {
    throw new Error(`Staging QA failed: ${qa.invalidGeomRows} invalid geometries (ST_IsValid=false)`);
  }
}

/** Parse attribute field names from `ogrinfo -so -al` stdout (Layer schema section). */
export function parseOgrinfoFieldNames(ogrinfoStdout: string): string[] {
  const lines = ogrinfoStdout.split(/\r?\n/);
  const fields: string[] = [];
  let inSchema = false;
  let afterGeometryColumn = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^Layer schema:/i.test(trimmed)) {
      inSchema = true;
      continue;
    }
    if (/^Geometry Column\s*=/i.test(trimmed)) {
      afterGeometryColumn = true;
      continue;
    }
    if (inSchema && trimmed === '') {
      break;
    }

    const match = trimmed.match(
      /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:String|Integer|Real|Date|DateTime|Binary|Integer64|Integer\(|Boolean\))/,
    );
    if (match && (inSchema || afterGeometryColumn)) {
      fields.push(match[1]);
    }
  }

  return fields;
}

export function assertExpectedColumnsPresent(
  actualColumns: readonly string[],
  expectedColumns: readonly string[],
  options?: { geometryColumns?: readonly string[] },
): void {
  if (expectedColumns.length === 0) return;

  const geometryColumns = new Set(
    (options?.geometryColumns ?? ['geom', 'geometri', 'the_geom']).map((c) => c.toLowerCase()),
  );
  const actual = new Set(actualColumns.map((c) => c.toLowerCase()));
  const missing = expectedColumns.filter((column) => !actual.has(column.toLowerCase()));

  if (missing.length > 0) {
    throw new Error(
      `Source schema QA failed: missing expected columns [${missing.join(', ')}]. Found: [${actualColumns.filter((c) => !geometryColumns.has(c.toLowerCase())).join(', ')}]`,
    );
  }
}

export function formatStagingQaSummary(qa: StagingQaResult): string {
  return JSON.stringify({
    phase: 'staging_qa',
    totalRows: qa.totalRows,
    nullGeomRows: qa.nullGeomRows,
    invalidGeomRows: qa.invalidGeomRows,
    srid: qa.srid,
  });
}

export function formatPromoteAuditSummary(audit: PromoteAuditResult): string {
  return JSON.stringify({
    phase: 'promote_audit',
    stagingRows: audit.stagingRows,
    prodRowsBefore: audit.prodRowsBefore,
    prodRowsAfter: audit.prodRowsAfter,
    deltaFromProd: audit.prodRowsAfter - audit.prodRowsBefore,
  });
}

async function tableHasGeomColumn(prisma: PrismaClient, qualifiedTable: string): Promise<boolean> {
  const [schema, table] = qualifiedTable.split('.');
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2 AND column_name = 'geom'
     ) AS exists`,
    schema,
    table,
  );
  return Boolean(rows[0]?.exists);
}

export async function runStagingVectorQa(
  prisma: PrismaClient,
  qualifiedStagingTable: string,
): Promise<StagingQaResult> {
  const hasGeom = await tableHasGeomColumn(prisma, qualifiedStagingTable);
  if (!hasGeom) {
    const countRows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*)::bigint AS n FROM ${qualifiedStagingTable}`,
    );
    const totalRows = Number(countRows[0]?.n ?? 0n);
    return { totalRows, nullGeomRows: 0, invalidGeomRows: 0, srid: null };
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      total_rows: bigint;
      null_geom_rows: bigint;
      invalid_geom_rows: bigint;
      srid: number | null;
    }>
  >(
    `SELECT
       COUNT(*)::bigint AS total_rows,
       COUNT(*) FILTER (WHERE geom IS NULL)::bigint AS null_geom_rows,
       COUNT(*) FILTER (WHERE geom IS NOT NULL AND NOT ST_IsValid(geom))::bigint AS invalid_geom_rows,
       MAX(ST_SRID(geom))::int AS srid
     FROM ${qualifiedStagingTable}`,
  );

  const row = rows[0];
  return {
    totalRows: Number(row?.total_rows ?? 0n),
    nullGeomRows: Number(row?.null_geom_rows ?? 0n),
    invalidGeomRows: Number(row?.invalid_geom_rows ?? 0n),
    srid: row?.srid ?? null,
  };
}

export async function countTableRows(prisma: PrismaClient, qualifiedTable: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*)::bigint AS n FROM ${qualifiedTable}`,
  );
  return Number(rows[0]?.n ?? 0n);
}

export async function listTableColumns(
  prisma: PrismaClient,
  schema: string,
  table: string,
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2
     ORDER BY ordinal_position`,
    schema,
    table,
  );
  return rows.map((r) => r.column_name);
}

/** Named-column promote — avoids SELECT * misalignment when staging has extra columns (e.g. id). */
export async function buildPromoteInsertSql(
  prisma: PrismaClient,
  targetSchema: string,
  targetTable: string,
  stagingSchema: string,
  stagingTable: string,
): Promise<string> {
  const prodCols = await listTableColumns(prisma, targetSchema, targetTable);
  const stgColSet = new Set(await listTableColumns(prisma, stagingSchema, stagingTable));
  const columns = prodCols.filter((c) => stgColSet.has(c));
  if (columns.length === 0) {
    throw new Error(
      `No overlapping columns between ${targetSchema}.${targetTable} and ${stagingSchema}.${stagingTable}`,
    );
  }
  const quoted = columns.map((c) => `"${c}"`).join(', ');
  return `INSERT INTO ${targetSchema}.${targetTable} (${quoted}) SELECT ${quoted} FROM ${stagingSchema}.${stagingTable}`;
}

export async function tableExists(prisma: PrismaClient, schema: string, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ exists: boolean }[]>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    `${schema}.${table}`,
  );
  return Boolean(rows[0]?.exists);
}

export function pickBrinColumnFromNames(columnNames: readonly string[]): string | null {
  const names = new Set(columnNames.map((c) => c.toLowerCase()));
  for (const candidate of BRIN_COLUMN_CANDIDATES) {
    if (names.has(candidate)) return candidate;
  }
  return null;
}

/** Session-level GUCs for index build + VACUUM (cannot use SET LOCAL — VACUUM is not transactional). */
export async function setBulkImportSession(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`SET maintenance_work_mem = '4GB'`);
  await prisma.$executeRawUnsafe(`SET work_mem = '1GB'`);
}

export async function resetBulkImportSession(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`RESET maintenance_work_mem`);
  await prisma.$executeRawUnsafe(`RESET work_mem`);
}

export async function resolveBrinIndexColumn(
  prisma: PrismaClient,
  schema: string,
  table: string,
): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2`,
    schema,
    table,
  );
  return pickBrinColumnFromNames(rows.map((r) => r.column_name));
}

export async function ensureGiSTIndex(
  prisma: PrismaClient,
  schema: string,
  table: string,
  indexName?: string,
): Promise<void> {
  const safeIndex = indexName ?? `idx_${table}_geom`;
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS ${safeIndex} ON ${schema}.${table} USING GIST (geom)`,
  );
}

export async function ensureBrinIndex(
  prisma: PrismaClient,
  schema: string,
  table: string,
  column: string,
  pagesPerRange = 128,
): Promise<void> {
  const safeIndex = `idx_${table}_brin_${column}`.replace(/[^a-z0-9_]/gi, '_');
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS ${safeIndex} ON ${schema}.${table} USING BRIN (${column}) WITH (pages_per_range=${pagesPerRange})`,
  );
}

export interface PostImportIndexingResult {
  rowCount: number;
  brinColumn: string | null;
  gistApplied: boolean;
}

/** GiST + optional BRIN + ANALYZE after promote (production table). */
export async function applyPostImportIndexing(
  prisma: PrismaClient,
  schema: string,
  table: string,
  options?: { minRowsForBrin?: number },
): Promise<PostImportIndexingResult> {
  const qualified = `${schema}.${table}`;
  const rowCount = await countTableRows(prisma, qualified);
  const minRows = options?.minRowsForBrin ?? DEFAULT_MIN_ROWS_FOR_BRIN;

  await setBulkImportSession(prisma);
  try {
    await ensureGiSTIndex(prisma, schema, table);

    let brinColumn: string | null = null;
    if (rowCount >= minRows) {
      brinColumn = await resolveBrinIndexColumn(prisma, schema, table);
      if (brinColumn) {
        await ensureBrinIndex(prisma, schema, table, brinColumn);
      }
    }

    await vacuumAnalyzeTable(prisma, qualified);
    return { rowCount, brinColumn, gistApplied: true };
  } finally {
    await resetBulkImportSession(prisma);
  }
}

export async function vacuumAnalyzeTable(prisma: PrismaClient, qualifiedTable: string): Promise<void> {
  await prisma.$executeRawUnsafe(`VACUUM ANALYZE ${qualifiedTable}`);
}

export function findMapLayerKeyForTable(schema: string, table: string): string | undefined {
  return ALL_DATASET_MAP_LAYERS.find((layer) => layer.schema === schema && layer.table === table)?.key;
}

export interface MapLayerSmokeOutcome {
  skipped: boolean;
  layerKey?: string;
  status?: 'ok' | 'fail' | 'degraded';
  detail?: string;
}

export async function smokeMapLayerForTable(
  schema: string,
  table: string,
): Promise<MapLayerSmokeOutcome> {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    return { skipped: true, detail: 'BASE_URL not set — skipping map-layer smoke' };
  }

  const layerKey = findMapLayerKeyForTable(schema, table);
  if (!layerKey) {
    return { skipped: true, detail: `No MAP_LAYER_CATALOG entry for ${schema}.${table}` };
  }

  const url = `${baseUrl}/api/layers/dataset/${encodeURIComponent(layerKey)}?bbox=${encodeURIComponent(DEFAULT_SMOKE_BBOX)}`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      return { skipped: false, layerKey, status: 'fail', detail: `HTTP ${res.status} ${res.statusText}` };
    }
    const body: unknown = await res.json();
    const isCollection =
      body &&
      typeof body === 'object' &&
      (body as { type?: string }).type === 'FeatureCollection' &&
      Array.isArray((body as { features?: unknown[] }).features);
    if (!isCollection) {
      return { skipped: false, layerKey, status: 'degraded', detail: 'Response is not a FeatureCollection' };
    }
    const featureCount = (body as { features: unknown[] }).features.length;
    return { skipped: false, layerKey, status: 'ok', detail: `${featureCount} features in smoke bbox` };
  } catch (err) {
    return {
      skipped: false,
      layerKey,
      status: 'fail',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
