import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

const DEFAULT_SOURCE_FILE =
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive\\Data\\VISS\\viss_api_waters\\2026-06-26_201626\\raw\\waters_cycle_3_2017_2021.json';
const MANAGEMENT_CYCLE_ID = '2';
const MANAGEMENT_CYCLE_LABEL = 'cycle_3_2017_2021';
const TARGET_TABLE = 'env.viss_status_cycle_3';
const BATCH_SIZE = 500;

type VissWaterRecord = {
  Name?: string | null;
  SwedishName?: string | null;
  EU_CD?: string | null;
  MS_CD?: string | null;
  UUID?: string | null;
  LengthKM?: number | null;
  SurfaceAreaKM2?: number | null;
  RBD?: string | null;
  Version?: string | null;
  Basin?: string | null;
  Authority?: string | null;
  Municipalites?: string[] | null;
  ResponsibleCountyCode?: string | null;
  IsReportUnit?: boolean | null;
  Category?: string | null;
  WaterCategoryIdentifier?: number | null;
};

function readRecords(sourceFile: string): VissWaterRecord[] {
  const parsed = JSON.parse(fs.readFileSync(sourceFile, 'utf8')) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : Object.values(parsed as Record<string, unknown>).find(Array.isArray);

  if (!Array.isArray(records)) {
    throw new Error(`VISS source file does not contain a record array: ${sourceFile}`);
  }

  return records as VissWaterRecord[];
}

function requireText(value: string | null | undefined, field: string, index: number): string {
  if (!value) {
    throw new Error(`Missing ${field} for VISS record index ${index}`);
  }
  return value;
}

function toNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toInteger(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

async function prepareTarget(client: pg.Client): Promise<void> {
  await client.query('CREATE SCHEMA IF NOT EXISTS env;');
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${TARGET_TABLE} (
      id BIGSERIAL PRIMARY KEY,
      management_cycle_id TEXT NOT NULL,
      management_cycle_label TEXT NOT NULL,
      eu_cd TEXT NOT NULL,
      ms_cd TEXT NOT NULL,
      uuid TEXT NOT NULL,
      name TEXT,
      swedish_name TEXT,
      category TEXT,
      water_category_identifier INTEGER,
      rbd TEXT,
      version TEXT,
      basin TEXT,
      authority TEXT,
      responsible_county_code TEXT,
      is_report_unit BOOLEAN,
      length_km DOUBLE PRECISION,
      surface_area_km2 DOUBLE PRECISION,
      municipalities TEXT[],
      raw JSONB NOT NULL,
      source_file TEXT NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (management_cycle_label, eu_cd)
    );
  `);
  await client.query(`TRUNCATE ${TARGET_TABLE};`);
}

async function insertBatch(client: pg.Client, sourceFile: string, records: VissWaterRecord[]): Promise<void> {
  const columns = [
    'management_cycle_id',
    'management_cycle_label',
    'eu_cd',
    'ms_cd',
    'uuid',
    'name',
    'swedish_name',
    'category',
    'water_category_identifier',
    'rbd',
    'version',
    'basin',
    'authority',
    'responsible_county_code',
    'is_report_unit',
    'length_km',
    'surface_area_km2',
    'municipalities',
    'raw',
    'source_file',
  ];
  const values: unknown[] = [];
  const rows = records.map((record, recordIndex) => {
    const base = values.length;
    values.push(
      MANAGEMENT_CYCLE_ID,
      MANAGEMENT_CYCLE_LABEL,
      requireText(record.EU_CD, 'EU_CD', recordIndex),
      requireText(record.MS_CD, 'MS_CD', recordIndex),
      requireText(record.UUID, 'UUID', recordIndex),
      record.Name ?? null,
      record.SwedishName ?? null,
      record.Category ?? null,
      toInteger(record.WaterCategoryIdentifier),
      record.RBD ?? null,
      record.Version ?? null,
      record.Basin ?? null,
      record.Authority ?? null,
      record.ResponsibleCountyCode ?? null,
      record.IsReportUnit ?? null,
      toNumber(record.LengthKM),
      toNumber(record.SurfaceAreaKM2),
      record.Municipalites ?? null,
      JSON.stringify(record),
      sourceFile,
    );

    const placeholders = columns.map((column, columnIndex) => {
      const position = base + columnIndex + 1;
      if (column === 'raw') return `$${position}::jsonb`;
      if (column === 'municipalities') return `$${position}::text[]`;
      return `$${position}`;
    });

    return `(${placeholders.join(', ')})`;
  });

  await client.query(
    `
      INSERT INTO ${TARGET_TABLE} (${columns.join(', ')})
      VALUES ${rows.join(', ')};
    `,
    values,
  );
}

async function createIndexes(client: pg.Client): Promise<void> {
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS viss_status_cycle_3_eu_cd_idx ON ${TARGET_TABLE} (eu_cd);`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS viss_status_cycle_3_ms_cd_idx ON ${TARGET_TABLE} (ms_cd);`);
  await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS viss_status_cycle_3_uuid_idx ON ${TARGET_TABLE} (uuid);`);
  await client.query(`CREATE INDEX IF NOT EXISTS viss_status_cycle_3_category_idx ON ${TARGET_TABLE} (category);`);
  await client.query(`CREATE INDEX IF NOT EXISTS viss_status_cycle_3_raw_gin_idx ON ${TARGET_TABLE} USING GIN (raw);`);
  await client.query(`ANALYZE ${TARGET_TABLE};`);
}

async function printVerification(client: pg.Client): Promise<void> {
  const counts = await client.query<{
    rows: number;
    eu_cd_unique: number;
    ms_cd_unique: number;
    uuid_unique: number;
  }>(`
    SELECT
      count(1)::int AS rows,
      count(DISTINCT eu_cd)::int AS eu_cd_unique,
      count(DISTINCT ms_cd)::int AS ms_cd_unique,
      count(DISTINCT uuid)::int AS uuid_unique
    FROM ${TARGET_TABLE};
  `);
  const indexes = await client.query<{ indexname: string }>(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'env' AND tablename = 'viss_status_cycle_3'
    ORDER BY indexname;
  `);
  const categories = await client.query<{ category: string | null; rows: number }>(`
    SELECT category, count(1)::int AS rows
    FROM ${TARGET_TABLE}
    GROUP BY category
    ORDER BY rows DESC;
  `);

  console.log(`verify: ${JSON.stringify(counts.rows[0])}`);
  console.log(`indexes: ${indexes.rows.map((row) => row.indexname).join(', ')}`);
  console.log(
    `categories: ${categories.rows.map((row) => `${row.category ?? 'null'}=${row.rows}`).join(', ')}`,
  );
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL saknas i .env');

  const sourceFile = path.resolve(process.argv[2] ?? DEFAULT_SOURCE_FILE);
  const records = readRecords(sourceFile);
  const client = new Client({ connectionString: databaseUrl });

  await client.connect();
  try {
    await client.query('BEGIN;');
    await prepareTarget(client);

    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      await insertBatch(client, sourceFile, records.slice(offset, offset + BATCH_SIZE));
    }

    await createIndexes(client);
    const result = await client.query<{ count: string }>(`SELECT count(*) AS count FROM ${TARGET_TABLE};`);
    await printVerification(client);
    await client.query('COMMIT;');
    console.log(`${TARGET_TABLE}: ${result.rows[0]?.count ?? '0'} rows imported from ${sourceFile}`);
  } catch (error) {
    await client.query('ROLLBACK;');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
