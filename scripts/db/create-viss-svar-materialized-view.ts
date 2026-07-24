import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Client } = pg;

const TARGET_VIEW = 'analytisk_miljo.viss_svar_kombinerad';
const VISS_TABLE = 'env.viss_status_cycle_3';
const SVAR_TABLE_SCHEMA = 'hydro';
const SVAR_TABLE_NAME = 'huvudavrinningsomraden';

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function qualified(schema: string, table: string): string {
  return `${quoteIdent(schema)}.${quoteIdent(table)}`;
}

async function getColumns(client: pg.Client, schema: string, table: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `,
    [schema, table],
  );
  return result.rows.map((row) => row.column_name);
}

function findColumn(columns: readonly string[], candidates: readonly string[]): string | null {
  const lowerToActual = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const actual = lowerToActual.get(candidate.toLowerCase());
    if (actual) return actual;
  }
  return null;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL saknas i .env');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const svarColumns = await getColumns(client, SVAR_TABLE_SCHEMA, SVAR_TABLE_NAME);
    const svarNameColumn = findColumn(svarColumns, ['name', 'namn']);
    const svarHaroColumn = findColumn(svarColumns, ['haro']);
    const svarGmlIdColumn = findColumn(svarColumns, ['gml_id']);

    const svarNameSql = svarNameColumn ? `s.${quoteIdent(svarNameColumn)}::text` : 'NULL::text';
    const svarHaroSql = svarHaroColumn ? `s.${quoteIdent(svarHaroColumn)}::text` : 'NULL::text';
    const svarGmlIdSql = svarGmlIdColumn ? `s.${quoteIdent(svarGmlIdColumn)}::text` : 'NULL::text';

    await client.query('CREATE SCHEMA IF NOT EXISTS analytisk_miljo;');
    await client.query(`DROP MATERIALIZED VIEW IF EXISTS ${TARGET_VIEW};`);
    await client.query(`
      CREATE MATERIALIZED VIEW ${TARGET_VIEW} AS
      WITH viss_points AS (
        SELECT
          v.id AS viss_row_id,
          v.uuid AS viss_uuid,
          v.eu_cd,
          v.ms_cd,
          v.name AS namn,
          v.swedish_name,
          v.category AS vattenkategori,
          v.water_category_identifier,
          v.rbd,
          v.version AS viss_version,
          v.basin,
          v.authority,
          v.responsible_county_code,
          v.is_report_unit,
          v.length_km,
          v.surface_area_km2,
          v.municipalities,
          v.raw,
          CASE
            WHEN sweref.coord IS NULL THEN NULL::geometry(Point, 3006)
            ELSE ST_SetSRID(
              ST_MakePoint(
                NULLIF(replace(sweref.coord->>'YValue', ',', '.'), '')::double precision,
                NULLIF(replace(sweref.coord->>'XValue', ',', '.'), '')::double precision
              ),
              3006
            )
          END AS viss_point_geom
        FROM ${VISS_TABLE} v
        LEFT JOIN LATERAL (
          SELECT coord
          FROM jsonb_array_elements(v.raw->'Coordinates') AS coord
          WHERE trim(coord->>'Format') = 'SWEREF99'
          LIMIT 1
        ) sweref ON true
      )
      SELECT
        v.viss_row_id,
        v.viss_uuid,
        v.eu_cd,
        v.ms_cd,
        v.vattenkategori,
        v.namn,
        v.swedish_name,
        v.water_category_identifier,
        v.rbd,
        v.viss_version,
        v.basin,
        v.authority,
        v.responsible_county_code,
        v.is_report_unit,
        v.length_km,
        v.surface_area_km2,
        v.municipalities,
        v.raw,
        ${svarGmlIdSql} AS svar_gml_id,
        ${svarHaroSql} AS haro,
        ${svarNameSql} AS haro_namn,
        'sweref99_point_in_haro'::text AS join_method,
        v.viss_point_geom,
        s.geom
      FROM viss_points v
      JOIN ${qualified(SVAR_TABLE_SCHEMA, SVAR_TABLE_NAME)} s
        ON regexp_replace(upper(coalesce(v.basin, '')), '^SE', '') =
           regexp_replace(upper(coalesce(${svarHaroSql}, '')), '^SE', '')
      WHERE s.geom IS NOT NULL;
    `);

    await client.query(`CREATE UNIQUE INDEX viss_svar_kombinerad_eu_cd_idx ON ${TARGET_VIEW} (eu_cd);`);
    await client.query(`CREATE INDEX viss_svar_kombinerad_ms_cd_idx ON ${TARGET_VIEW} (ms_cd);`);
    await client.query(`CREATE INDEX viss_svar_kombinerad_uuid_idx ON ${TARGET_VIEW} (viss_uuid);`);
    await client.query(`CREATE INDEX viss_svar_kombinerad_category_idx ON ${TARGET_VIEW} (vattenkategori);`);
    await client.query(`CREATE INDEX viss_svar_kombinerad_geom_idx ON ${TARGET_VIEW} USING GIST (geom);`);
    await client.query(
      `CREATE INDEX viss_svar_kombinerad_point_geom_idx ON ${TARGET_VIEW} USING GIST (viss_point_geom);`,
    );
    await client.query(`ANALYZE ${TARGET_VIEW};`);

    const result = await client.query<{
      rows: number;
      viss_rows: number;
      matched_rows: number;
      distinct_haro: number;
    }>(`
      SELECT
        (SELECT count(1)::int FROM ${TARGET_VIEW}) AS rows,
        (SELECT count(1)::int FROM ${VISS_TABLE}) AS viss_rows,
        count(DISTINCT v.eu_cd)::int AS matched_rows,
        count(DISTINCT v.haro)::int AS distinct_haro
      FROM ${TARGET_VIEW} v;
    `);
    const categories = await client.query<{ vattenkategori: string | null; rows: number }>(`
      SELECT vattenkategori, count(1)::int AS rows
      FROM ${TARGET_VIEW}
      GROUP BY vattenkategori
      ORDER BY rows DESC;
    `);

    console.log(`view: ${TARGET_VIEW}`);
    console.log(`verify: ${JSON.stringify(result.rows[0])}`);
    console.log(
      `categories: ${categories.rows.map((row) => `${row.vattenkategori ?? 'null'}=${row.rows}`).join(', ')}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
