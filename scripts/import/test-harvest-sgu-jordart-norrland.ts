/**
 * Norrland bbox test harvest for SGU Jordarter25k100k (grundlager).
 * Validates OAPIF pagination + coordinate axis order before full ~3M re-harvest.
 *
 * Uses direct GeoJSON fetch (bbox WGS84 + startIndex) because ogr2ogr OAPIF + -spat
 * paginates correctly but discards all features on the local spatial filter.
 *
 * Usage:
 *   npx tsx scripts/import/test-harvest-sgu-jordart-norrland.ts
 *   npx tsx scripts/import/test-harvest-sgu-jordart-norrland.ts --limit=25001
 */
import { spawnSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const OGRINFO_PATH = process.env.OGRINFO_PATH || 'C:\\Program Files\\GDAL\\ogrinfo.exe';

const ITEMS_URL =
  'https://api.sgu.se/oppnadata/jordarter25k-100k/ogc/features/v1/collections/grundlager/items';

/** Inner Västerbotten (Lycksele–Umeå inland), WGS84: minLon minLat maxLon maxLat */
const BBOX_WGS84 = { minLon: 16.0, minLat: 64.8, maxLon: 18.5, maxLat: 66.0 };
const PAGE_SIZE = 5000;

const OUT_DIR = path.join(process.cwd(), 'storage', 'manifests', 'sgu-jordart-test-harvest');
const OUT_GPKG = path.join(OUT_DIR, 'Jordart_norrland_test.gpkg');
const MERGED_GEOJSON = path.join(OUT_DIR, 'merged.geojson');
const PAGINATION_LOG = path.join(OUT_DIR, 'pagination.log');
const REPORT_JSON = path.join(OUT_DIR, 'test-harvest-report.json');

type GeoJsonFeatureCollection = {
  type: 'FeatureCollection';
  features: Array<{ type: 'Feature'; id?: string; properties: Record<string, unknown>; geometry: unknown }>;
  numberMatched?: number;
  numberReturned?: number;
};

function readArg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1]! : fallback;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex').toUpperCase();
}

async function fetchPage(startIndex: number): Promise<GeoJsonFeatureCollection> {
  const params = new URLSearchParams({
    bbox: `${BBOX_WGS84.minLon},${BBOX_WGS84.minLat},${BBOX_WGS84.maxLon},${BBOX_WGS84.maxLat}`,
    limit: String(PAGE_SIZE),
    startIndex: String(startIndex),
  });
  const url = `${ITEMS_URL}?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/geo+json, application/json' },
  });
  if (!response.ok) {
    throw new Error(`SGU API ${response.status} for startIndex=${startIndex}: ${await response.text()}`);
  }
  return (await response.json()) as GeoJsonFeatureCollection;
}

async function harvestGeoJson(targetLimit: number): Promise<{
  featureCount: number;
  pagesFetched: number;
  numberMatched: number;
  pageLog: string[];
}> {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const merged: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };
  const pageLog: string[] = [];
  let startIndex = 0;
  let numberMatched = 0;
  let pagesFetched = 0;

  while (merged.features.length < targetLimit) {
    const page = await fetchPage(startIndex);
    numberMatched = page.numberMatched ?? numberMatched;
    const returned = page.features?.length ?? 0;
    const line = `startIndex=${startIndex} returned=${returned} numberMatched=${numberMatched} total=${merged.features.length + returned}`;
    pageLog.push(line);
    console.log(`  ${line}`);

    if (returned === 0) break;

    merged.features.push(...page.features);
    pagesFetched += 1;
    startIndex += PAGE_SIZE;

    if (merged.features.length >= targetLimit) {
      merged.features = merged.features.slice(0, targetLimit);
      break;
    }
    if (returned < PAGE_SIZE) break;
  }

  fs.writeFileSync(PAGINATION_LOG, `${pageLog.join('\n')}\n`, 'utf8');
  fs.writeFileSync(MERGED_GEOJSON, JSON.stringify(merged), 'utf8');

  return {
    featureCount: merged.features.length,
    pagesFetched,
    numberMatched,
    pageLog,
  };
}

function convertToGpkg(): number {
  if (fs.existsSync(OUT_GPKG)) fs.unlinkSync(OUT_GPKG);

  const args = [
    '-f',
    'GPKG',
    OUT_GPKG,
    MERGED_GEOJSON,
    '-t_srs',
    'EPSG:3006',
    '-nln',
    'grundlager_test',
    '-overwrite',
  ];

  console.log(`\nogr2ogr ${args.join(' ')}`);
  console.log('Env: OAMS_TRADITIONAL_GIS_ORDER=YES (traditional GIS axis order for EPSG:3006)');

  const result = spawnSync(OGR2OGR_PATH, args, {
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, OAMS_TRADITIONAL_GIS_ORDER: 'YES' },
  });

  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (combined.trim()) console.log(combined.trim());
  return result.status ?? 1;
}

function analyzeGpkg(): {
  sqlCount: number;
  minX: number | null;
  maxX: number | null;
  minY: number | null;
  maxY: number | null;
} {
  const empty = { sqlCount: 0, minX: null, maxX: null, minY: null, maxY: null };
  if (!fs.existsSync(OUT_GPKG)) {
    console.error('No output GPKG — conversion failed.');
    return empty;
  }

  const sqlResult = spawnSync(
    OGRINFO_PATH,
    ['-sql', 'SELECT COUNT(*) AS n FROM grundlager_test', OUT_GPKG],
    { encoding: 'utf-8' },
  );
  const sqlCount = Number((`${sqlResult.stdout ?? ''}`.match(/n \(Integer\) = (\d+)/) ?? [])[1] ?? 0);

  const extentResult = spawnSync(
    OGRINFO_PATH,
    [
      '-dialect',
      'SQLite',
      '-sql',
      'SELECT MIN(ST_MinX(geom)), MAX(ST_MaxX(geom)), MIN(ST_MinY(geom)), MAX(ST_MaxY(geom)) FROM grundlager_test',
      OUT_GPKG,
    ],
    { encoding: 'utf-8' },
  );
  const extentText = `${extentResult.stdout ?? ''}`;
  const nums = extentText.match(/\(Real\) = ([\d.]+)/g)?.map((m) => Number(m.replace(/\(Real\) = /, ''))) ?? [];

  console.log('\n=== GPKG analysis ===');
  console.log(`Feature count (SQL): ${sqlCount}`);
  console.log(`File size MB:        ${(fs.statSync(OUT_GPKG).size / (1024 * 1024)).toFixed(1)}`);
  if (nums.length === 4) {
    console.log(`Extent EPSG:3006:    X ${nums[0]?.toFixed(0)}–${nums[1]?.toFixed(0)}, Y ${nums[2]?.toFixed(0)}–${nums[3]?.toFixed(0)}`);
  }

  console.log('\nCoordinate sanity (EPSG:3006, inner Västerbotten expected):');
  console.log('  easting (X) ~ 300000–900000, northing (Y) ~ 7000000–7400000');
  console.log('  If X is ~7M and Y ~500k → axes still swapped.');

  return {
    sqlCount,
    minX: nums[0] ?? null,
    maxX: nums[1] ?? null,
    minY: nums[2] ?? null,
    maxY: nums[3] ?? null,
  };
}

function coordsLookCorrect(minX: number | null, maxX: number | null, minY: number | null, maxY: number | null): boolean {
  if (minX == null || maxX == null || minY == null || maxY == null) return false;
  const xLooksLikeEasting = minX < 2_000_000 && maxX < 2_000_000;
  const yLooksLikeNorthing = minY > 6_000_000 && maxY > 6_000_000;
  return xLooksLikeEasting && yLooksLikeNorthing;
}

async function main() {
  const targetLimit = Number(readArg('limit', '25001'));

  console.log('\n=== SGU Jordart Norrland test harvest ===');
  console.log(`Bbox WGS84: ${JSON.stringify(BBOX_WGS84)}`);
  console.log(`Target: ${targetLimit} features (PAGE_SIZE=${PAGE_SIZE} → expect ≥5 pages when limit≥25001)`);
  console.log(`Output dir: ${OUT_DIR}\n`);

  console.log('Phase 1: HTTP pagination (GeoJSON)...');
  const harvest = await harvestGeoJson(targetLimit);
  console.log(`\nFetched ${harvest.featureCount} features in ${harvest.pagesFetched} pages`);
  console.log(`API numberMatched for bbox: ${harvest.numberMatched}`);
  console.log(`Pagination log: ${PAGINATION_LOG}`);

  console.log('\nPhase 2: ogr2ogr GeoJSON → GPKG (EPSG:3006)...');
  const ogrStatus = convertToGpkg();
  const analysis = analyzeGpkg();

  const paginationPass = harvest.pagesFetched >= 5 && analysis.sqlCount >= 25001;
  const coordsPass = coordsLookCorrect(analysis.minX, analysis.maxX, analysis.minY, analysis.maxY);

  const report = {
    harvested_at: new Date().toISOString(),
    bbox_wgs84: BBOX_WGS84,
    page_size: PAGE_SIZE,
    target_limit: targetLimit,
    features_fetched: harvest.featureCount,
    pages_fetched: harvest.pagesFetched,
    api_number_matched: harvest.numberMatched,
    gpkg_feature_count: analysis.sqlCount,
    gpkg_path: OUT_GPKG,
    gpkg_sha256: fs.existsSync(OUT_GPKG) ? sha256File(OUT_GPKG) : null,
    extent_epsg3006: {
      min_x: analysis.minX,
      max_x: analysis.maxX,
      min_y: analysis.minY,
      max_y: analysis.maxY,
    },
    coordinate_fix: 'OAMS_TRADITIONAL_GIS_ORDER=YES + GeoJSON -t_srs EPSG:3006',
    pagination_pass: paginationPass,
    coordinates_pass: coordsPass,
    overall_pass: paginationPass && coordsPass && ogrStatus === 0,
    page_log: harvest.pageLog,
  };

  fs.writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('\n=== Verdict ===');
  console.log(`Downloaded: ${analysis.sqlCount} features (${harvest.pagesFetched} API pages)`);
  console.log(`Pagination: ${paginationPass ? 'PASS' : 'FAIL'} (need ≥5 pages and ≥25001 features)`);
  console.log(`Coordinates: ${coordsPass ? 'PASS' : 'FAIL'}`);
  console.log(`Overall: ${report.overall_pass ? 'PASS — ready for full re-harvest planning' : 'FAIL — fix before national download'}`);
  console.log(`Report: ${REPORT_JSON}`);

  if (!report.overall_pass || ogrStatus !== 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
