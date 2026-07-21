/**
 * Compare app-expected GIS tables vs local PostGIS inventory.
 * Usage: node scripts/db/audit-app-gis-layers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { PrismaClient } from '@prisma/client';

loadDotenv({ path: '.env' });
loadDotenv({ path: '.env.local', override: true });

const prisma = new PrismaClient();

const UPPSALA_BBOX = { minLng: 17.55, minLat: 59.82, maxLng: 17.75, maxLat: 59.92 };

/** Tables the app reads directly (gis routes / publicUiService / spatial audit). */
const DIRECT_APP_TABLES = [
  { key: 'postgis_nvr', schema: 'env', table: 'protected_area', geom: 'wkb_geometry' },
  { key: 'natura2000_area', schema: 'env', table: 'natura2000_area', geom: 'wkb_geometry' },
  { key: 'water_protection', schema: 'env', table: 'water_protection_area', geom: 'wkb_geometry' },
  { key: 'postgis_property', schema: 'env', table: 'registerenhetsomradesytor', geom: 'geom' },
  { key: 'postgis_lakes', schema: 'hydro', table: 'lake', geom: 'geom' },
  { key: 'postgis_streams', schema: 'hydro', table: 'stream', geom: 'geom' },
  { key: 'hydro_water_catchment', schema: 'hydro', table: 'water_catchment', geom: 'geom' },
  { key: 'hydro_main_catchment', schema: 'hydro', table: 'water_body', geom: 'geom' },
  { key: 'climate_flood_risk', schema: 'climate', table: 'flood_risk_area', geom: 'geom' },
  { key: 'sgu_grundlager', schema: 'env', table: 'sgu_soil_type_25k_100k', geom: 'geom' },
  { key: 'sgu_brunnar_postgis', schema: 'env', table: 'sgu_well', geom: 'geom' },
  { key: 'sgu_brunnar_alt', schema: 'env', table: 'sgu_well_actual', geom: 'geom' },
  { key: 'sgu_genomslapplighet', schema: 'env', table: 'sgu_permeability', geom: 'geom' },
  { key: 'sgu_groundwater_magazine', schema: 'env', table: 'sgu_groundwater_magazine', geom: 'geom' },
  { key: 'sgu_groundwater_body', schema: 'env', table: 'sgu_groundwater_body', geom: 'geom' },
  { key: 'sgu_jordskred_raviner', schema: 'env', table: 'sgu_landslide_feature', geom: 'geom' },
  { key: 'slu_lake_catchment', schema: 'hydro', table: 'slu_lake_catchment', geom: 'geom' },
  { key: 'raa_building_ruin', schema: 'env', table: 'raa_building_ruin', geom: 'geom' },
];

/** From platform-datasources / dataset/:layerKey (always geom). */
const PLATFORM_TABLES = [
  ['env', 'sgu_ground_layer_1m'],
  ['env', 'sgu_landslide_feature'],
  ['env', 'sgu_soil_type_25k_100k'],
  ['env', 'env_sgu_grundvatten_sarbarhet'],
  ['env', 'sgu_well'],
  ['env', 'sgu_aktsamhet_efterarbetad'],
  ['env', 'sgu_erosion_aktiv'],
  ['env', 'sgu_fastmark_stabilitet'],
  ['env', 'registerenhetsomradesytor'],
  ['env', 'registerenhetsomradeslinjer'],
  ['core', 'lm_mark'],
  ['core', 'lm_byggnad'],
  ['core', 'lm_vatten'],
  ['env', 'protected_area'],
  ['env', 'raa_fornlamning'],
  ['env', 'lst_vattenskydd'],
  ['env', 'lst_miljofarlig_verksamhet'],
  ['env', 'viss_vattenforekomst'],
  ['env', 'smed_belastning_vatten'],
  ['env', 'smed_utslapp_luft_1km'],
  ['hydro', 'smhi_huvudavrinningsomrade'],
  ['env', 'slu_artobservation'],
  ['env', 'skogsstyrelsen_nyckelbiotop'],
  ['env', 'skogsstyrelsen_naturvarde'],
];

function quoteIdent(id) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(id)) throw new Error(`bad ident ${id}`);
  return `"${id}"`;
}

async function regclass(schema, table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT to_regclass($1)::text AS regclass`,
    `${schema}.${table}`,
  );
  return rows[0]?.regclass ?? null;
}

async function estimateRows(schema, table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT reltuples::bigint AS est FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
    schema,
    table,
  );
  return Number(rows[0]?.est ?? 0);
}

async function exactRows(schema, table) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(schema)}.${quoteIdent(table)}`,
  );
  return Number(rows[0]?.c ?? 0);
}

async function hasColumn(schema, table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3 LIMIT 1`,
    schema,
    table,
    column,
  );
  return rows.length > 0;
}

async function hasGistOnGeom(schema, table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 AND indexdef ILIKE '%USING gist%' AND indexdef ILIKE $3`,
    schema,
    table,
    `%${column}%`,
  );
  return rows.length > 0;
}

async function bboxHits(schema, table, geom) {
  const sql = `
    SELECT COUNT(*)::int AS c
    FROM ${quoteIdent(schema)}.${quoteIdent(table)} t
    WHERE t.${quoteIdent(geom)} IS NOT NULL
      AND t.${quoteIdent(geom)} && ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006)
      AND ST_Intersects(t.${quoteIdent(geom)}, ST_Transform(ST_MakeEnvelope($1, $2, $3, $4, 4326), 3006))
  `;
  const rows = await prisma.$queryRawUnsafe(
    sql,
    UPPSALA_BBOX.minLng,
    UPPSALA_BBOX.minLat,
    UPPSALA_BBOX.maxLng,
    UPPSALA_BBOX.maxLat,
  );
  return Number(rows[0]?.c ?? 0);
}

async function auditTable(entry) {
  const { schema, table, geom, key } = entry;
  const exists = await regclass(schema, table);
  if (!exists) {
    return { key, schema, table, status: 'MISSING', rows: 0, bboxHits: 0, geomOk: false, gist: false };
  }
  const geomOk = await hasColumn(schema, table, geom);
  const gist = geomOk ? await hasGistOnGeom(schema, table, geom) : false;
  let rows = await estimateRows(schema, table);
  if (rows < 0) rows = 0;
  let hits = 0;
  if (geomOk) {
    try {
      hits = await bboxHits(schema, table, geom);
    } catch {
      hits = -1;
    }
  }
  const status = !geomOk ? 'NO_GEOM_COL' : hits > 0 ? 'OK' : hits === 0 ? 'EMPTY_BBOX' : 'BBOX_ERROR';
  return { key, schema, table, status, rows, bboxHits: hits, geomOk, gist, geom };
}

async function main() {
  console.log('PostGIS audit — app GIS tables vs Docker DB');
  console.log(`DATABASE: ${(process.env.DATABASE_URL || '').replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`BBOX sample: Uppsala ${UPPSALA_BBOX.minLng},${UPPSALA_BBOX.minLat}..${UPPSALA_BBOX.maxLng},${UPPSALA_BBOX.maxLat}\n`);

  const pgVersion = await prisma.$queryRawUnsafe(`SELECT PostGIS_Version() AS v`);
  console.log('PostGIS:', pgVersion[0]?.v);

  const totalEst = await prisma.$queryRawUnsafe(`
    SELECT SUM(reltuples)::bigint AS total_est
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND c.relkind = 'r'
  `);
  console.log('Estimated total rows (all user tables):', Number(totalEst[0]?.total_est ?? 0).toLocaleString('sv-SE'));

  const top = await prisma.$queryRawUnsafe(`
    SELECT n.nspname AS schema, c.relname AS table, c.reltuples::bigint AS est
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast')
      AND c.relkind = 'r'
      AND c.reltuples > 0
    ORDER BY c.reltuples DESC
    LIMIT 12
  `);
  console.log('\nTop tables by estimated rows:');
  for (const r of top) {
    console.log(`  ${r.schema}.${r.table}: ${Number(r.est).toLocaleString('sv-SE')}`);
  }

  const unique = new Map();
  for (const t of DIRECT_APP_TABLES) unique.set(`${t.schema}.${t.table}:${t.geom}`, t);
  for (const [schema, table] of PLATFORM_TABLES) {
    const k = `${schema}.${table}:geom`;
    if (!unique.has(k)) unique.set(k, { key: `dataset/${schema}.${table}`, schema, table, geom: 'geom' });
  }

  console.log('\n--- App-expected GIS tables ---');
  console.log('KEY | SCHEMA.TABLE | STATUS | ~ROWS | BBOX_HITS | GEOM | GIST');
  const results = [];
  for (const entry of unique.values()) {
    const r = await auditTable(entry);
    results.push(r);
    console.log(
      `${r.key} | ${r.schema}.${r.table} | ${r.status} | ${r.rows.toLocaleString('sv-SE')} | ${r.bboxHits} | ${r.geom ?? '-'} | ${r.gist ? 'yes' : 'no'}`,
    );
  }

  const ok = results.filter((r) => r.status === 'OK').length;
  const missing = results.filter((r) => r.status === 'MISSING').length;
  const empty = results.filter((r) => r.status === 'EMPTY_BBOX').length;
  const noGeom = results.filter((r) => r.status === 'NO_GEOM_COL').length;
  console.log(`\nSummary: OK=${ok} MISSING=${missing} EMPTY_BBOX=${empty} NO_GEOM_COL=${noGeom} TOTAL=${results.length}`);

  // App tables (Prisma public)
  console.log('\n--- Application tables (sample) ---');
  for (const table of ['User', 'Organisation', 'Project', 'DocumentRecord']) {
    try {
      const c = await exactRows('public', table);
      console.log(`  public.${table}: ${c.toLocaleString('sv-SE')}`);
    } catch (e) {
      console.log(`  public.${table}: ERROR ${e.message}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
