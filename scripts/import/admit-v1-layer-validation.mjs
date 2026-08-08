#!/usr/bin/env node
/**
 * Admit v1 layer-validation checklist runner.
 *
 * Offline (default): validates frozen checklist JSON vs Admit contracts — no DB.
 * Live (--live): runs SRID / count / bbox / geom-type smoke against PostGIS.
 *
 * Usage:
 *   node scripts/import/admit-v1-layer-validation.mjs
 *   node scripts/import/admit-v1-layer-validation.mjs --plan
 *   node scripts/import/admit-v1-layer-validation.mjs --live
 *   node scripts/import/admit-v1-layer-validation.mjs --live --only lu.ebh
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIT_ORDER,
  REQUIRED_CHECKS,
  validateChecklistOffline,
} from './lib/admitV1LayerValidationChecklist.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const CHECKLIST_PATH = path.join(
  ROOT,
  'docs/architecture/admit-v1/LAYER-VALIDATION-CHECKLIST-V1.json',
);
const LEDGER_PATH = path.join(
  ROOT,
  'docs/architecture/admit-v1/master-walk-pass2-sha-ledger.json',
);
const OUT_DIR = path.join(ROOT, 'storage/manifests/admit-v1-import');

function parseArgs(argv) {
  const out = { live: false, plan: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--live') out.live = true;
    if (argv[i] === '--plan') out.plan = true;
    if (argv[i] === '--only') out.only = argv[++i];
  }
  return out;
}

function loadChecklist() {
  return JSON.parse(fs.readFileSync(CHECKLIST_PATH, 'utf8'));
}

function loadLedgerShaByLayer() {
  if (!fs.existsSync(LEDGER_PATH)) return null;
  const ledger = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
  const map = new Map();
  for (const row of ledger.entries || []) {
    if (row.layer_id && row.source_sha256) {
      map.set(row.layer_id, row.source_sha256);
    }
  }
  return map;
}

function splitTable(qualified) {
  const [schema, table] = qualified.split('.');
  return { schema, table };
}

async function validateLayerLive(client, checklist, layer) {
  const results = [];
  const { schema, table } = splitTable(layer.postgis_table);
  const geom = layer.geom_column || 'geom';
  const bbox = checklist.sweden_bbox_3006;

  const existsRes = await client.query(`SELECT to_regclass($1) AS reg`, [
    `${schema}.${table}`,
  ]);
  const exists = Boolean(existsRes.rows[0]?.reg);
  results.push({
    check: 'table_exists',
    ok: exists,
    detail: exists ? `${schema}.${table}` : 'missing',
  });
  if (!exists) {
    for (const check of REQUIRED_CHECKS.filter((c) => c !== 'table_exists')) {
      results.push({ check, ok: false, detail: 'skipped — table missing' });
    }
    return results;
  }

  if (layer.sync_table) {
    const sync = splitTable(layer.sync_table);
    const syncRes = await client.query(`SELECT to_regclass($1) AS reg`, [
      `${sync.schema}.${sync.table}`,
    ]);
    results.push({
      check: 'sync_table_exists',
      ok: Boolean(syncRes.rows[0]?.reg),
      detail: layer.sync_table,
    });
  }

  const countRes = await client.query(
    `SELECT COUNT(*)::bigint AS n FROM ${schema}.${table}`,
  );
  const rowCount = Number(countRes.rows[0].n);
  results.push({
    check: 'row_count_gt_0',
    ok: rowCount > 0,
    detail: `rows=${rowCount}`,
  });

  const sridRes = await client.query(
    `SELECT DISTINCT ST_SRID(${geom}) AS srid
     FROM ${schema}.${table}
     WHERE ${geom} IS NOT NULL
     LIMIT 5`,
  );
  const srids = sridRes.rows.map((r) => Number(r.srid));
  const sridOk = srids.length > 0 && srids.every((s) => s === checklist.srid_required);
  results.push({
    check: 'srid_is_3006',
    ok: sridOk,
    detail: srids.length ? `srids=[${srids.join(',')}]` : 'no geometry',
  });

  const nullRes = await client.query(
    `SELECT COUNT(*)::bigint AS n FROM ${schema}.${table} WHERE ${geom} IS NULL`,
  );
  const nullCount = Number(nullRes.rows[0].n);
  const allowedNull = layer.layer_id === 'lu.water_wells';
  results.push({
    check: 'geom_not_null',
    ok: allowedNull ? true : nullCount === 0,
    detail: `null_geom=${nullCount}${allowedNull ? ' (allowed)' : ''}`,
  });

  const bboxRes = await client.query(
    `SELECT
       ST_XMin(e) AS minx, ST_XMax(e) AS maxx,
       ST_YMin(e) AS miny, ST_YMax(e) AS maxy
     FROM (
       SELECT ST_Extent(${geom}) AS e FROM ${schema}.${table} WHERE ${geom} IS NOT NULL
     ) q`,
  );
  const b = bboxRes.rows[0];
  let bboxOk = false;
  let bboxDetail = 'empty extent';
  if (b?.minx != null) {
    bboxOk =
      Number(b.maxx) >= bbox.min_easting &&
      Number(b.minx) <= bbox.max_easting &&
      Number(b.maxy) >= bbox.min_northing &&
      Number(b.miny) <= bbox.max_northing;
    bboxDetail = `extent=[${b.minx},${b.miny}]-[${b.maxx},${b.maxy}]`;
  }
  results.push({
    check: 'bbox_intersects_sweden_envelope',
    ok: bboxOk,
    detail: bboxDetail,
  });

  const typeRes = await client.query(
    `SELECT DISTINCT GeometryType(${geom}) AS gtype
     FROM ${schema}.${table}
     WHERE ${geom} IS NOT NULL
     LIMIT 20`,
  );
  const GEOM_TYPE_MAP = {
    POINT: 'ST_Point',
    MULTIPOINT: 'ST_MultiPoint',
    POLYGON: 'ST_Polygon',
    MULTIPOLYGON: 'ST_MultiPolygon',
    LINESTRING: 'ST_LineString',
    MULTILINESTRING: 'ST_MultiLineString',
    GEOMETRYCOLLECTION: 'ST_GeometryCollection',
  };
  const allowed = new Set(layer.expected_geometry_types);
  const asChecklist = typeRes.rows.map((r) => {
    const raw = String(r.gtype || '').toUpperCase();
    return GEOM_TYPE_MAP[raw] || `ST_${raw}`;
  });
  const typeOk = asChecklist.length > 0 && asChecklist.every((t) => allowed.has(t));
  results.push({
    check: 'geometry_type_allowed',
    ok: typeOk,
    detail: `types=[${asChecklist.join(',')}] allowed=[${[...allowed].join(',')}]`,
  });

  return results;
}

async function runLive(checklist, only) {
  const { default: pg } = await import('pg');
  const dbUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://miljobeslut:miljobeslut@localhost:5432/miljobeslut?sslmode=disable';

  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();

  const layers = (checklist.layers || []).filter((l) => !only || l.layer_id === only);
  const layerReports = [];

  try {
    for (const layer of layers) {
      const checks = await validateLayerLive(client, checklist, layer);
      const ok = checks.every((c) => c.ok);
      layerReports.push({
        layer_id: layer.layer_id,
        postgis_table: layer.postgis_table,
        ok,
        checks,
      });
      console.log(`${ok ? '[OK]' : '[FAIL]'} ${layer.layer_id} (${layer.postgis_table})`);
      for (const c of checks) {
        console.log(`   ${c.ok ? '.' : '!'} ${c.check}: ${c.detail}`);
      }
    }
  } finally {
    await client.end();
  }

  return layerReports;
}

function writeReport(report) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(OUT_DIR, `layer-validation-${report.mode}-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(report, null, 2), 'utf8');
  const latest = path.join(OUT_DIR, `layer-validation-${report.mode}-latest.json`);
  fs.writeFileSync(latest, JSON.stringify(report, null, 2), 'utf8');
  return file;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const checklist = loadChecklist();
  const ledgerMap = loadLedgerShaByLayer();

  if (args.plan) {
    console.log(`Checklist: ${checklist.checklist_id}`);
    console.log(`SRID: ${checklist.srid_required}`);
    console.log(`Admit order (${ADMIT_ORDER.length}):`);
    for (const layer of checklist.layers) {
      console.log(
        `  ${String(layer.priority).padStart(2)}. ${layer.layer_id.padEnd(22)} -> ${layer.postgis_table}${layer.logical_ui ? ` (ui:${layer.logical_ui})` : ''}`,
      );
    }
    console.log('Excluded:');
    for (const ex of checklist.excluded || []) {
      console.log(`  - ${ex.layer_id} (${ex.admit_status})`);
    }
    console.log('\nChecks:', checklist.checks_per_layer.join(', '));
    return;
  }

  const offline = validateChecklistOffline(checklist, ledgerMap);
  console.log(`\n[offline] checklist integrity: ${offline.ok ? 'GREEN' : 'RED'}`);
  for (const w of offline.warnings) console.warn(`  warn: ${w}`);
  for (const e of offline.errors) console.error(`  error: ${e}`);

  const report = {
    checklist_id: checklist.checklist_id,
    mode: args.live ? 'live' : 'offline',
    generated_at: new Date().toISOString(),
    offline,
    layers: null,
    ok: offline.ok,
  };

  if (!offline.ok) {
    const file = writeReport(report);
    console.error(`\nReport: ${file}`);
    process.exit(1);
  }

  if (!args.live) {
    const file = writeReport(report);
    console.log(`\nOffline GREEN — no DB touched.`);
    console.log(`When PostGIS import is ready: npm run admit:validate-layers -- --live`);
    console.log(`Report: ${file}`);
    return;
  }

  console.log('\n[live] running PostGIS smoke checks...');
  const layerReports = await runLive(checklist, args.only);
  const byId = new Map((checklist.layers || []).map((l) => [l.layer_id, l]));
  const receiptLayers = layerReports.map((lr) => {
    const meta = byId.get(lr.layer_id);
    const rowCheck = lr.checks.find((c) => c.check === 'row_count_gt_0');
    const sridCheck = lr.checks.find((c) => c.check === 'srid_is_3006');
    const rowMatch = rowCheck?.detail?.match(/rows=(\d+)/);
    return {
      layer_id: lr.layer_id,
      source_sha256: meta?.source_sha256 ?? null,
      postgis_table: lr.postgis_table,
      row_count: rowMatch ? Number(rowMatch[1]) : null,
      srid: sridCheck?.ok ? checklist.srid_required : null,
      ok: lr.ok,
      checks: lr.checks,
    };
  });
  report.layers = layerReports;
  report.ok = offline.ok && layerReports.every((l) => l.ok);
  report.receipt = {
    receipt_id: `admit-v1-live-${new Date().toISOString()}`,
    gate: 'ADMIT_V1_LIVE_LAYER_ACCEPTANCE',
    generated_at: new Date().toISOString(),
    mode: 'live',
    ok: report.ok,
    hard_fail: true,
    layers: receiptLayers,
    chain_claim: report.ok
      ? 'Admit v1 sources produced PostGIS layers and passed live acceptance (hard).'
      : 'Admit v1 live acceptance FAILED — not almost-green.',
  };

  const file = writeReport(report);
  const receiptPath = path.join(OUT_DIR, 'layer-validation-live-receipt-latest.json');
  fs.writeFileSync(receiptPath, `${JSON.stringify(report.receipt, null, 2)}\n`, 'utf8');
  console.log(`\nLive ${report.ok ? 'GREEN' : 'RED'}`);
  console.log(`Report: ${file}`);
  console.log(`Receipt: ${receiptPath}`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
