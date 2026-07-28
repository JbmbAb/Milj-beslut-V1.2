/**
 * Fill empty PostGIS gaps from Master Archive (already harvested).
 * Mimers Brunn: no re-download — archive → PostGIS only.
 *
 *   npx tsx scripts/import/fill-empty-gaps-from-archive.ts
 *   npx tsx scripts/import/fill-empty-gaps-from-archive.ts --execute
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const ARCHIVE =
  process.env.GEO_MASTER_ARCHIVE ||
  'H:\\Delade enheter\\Miljöbeslut\\GEO_Master_Archive';
const OGR2OGR = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const PG =
  process.env.OGR_PG ||
  'PG:host=127.0.0.1 port=5432 dbname=miljobeslut user=miljobeslut password=miljobeslut';

const execute = process.argv.includes('--execute');

type Job = {
  id: string;
  source: string;
  layer?: string;
  target: string; // schema.table
  dropFirst?: boolean;
};

const jobs: Job[] = [
  {
    id: 'msb-stora-olyckor',
    source: path.join(
      ARCHIVE,
      'Data/MSB/InspireMSB_storaolyckor/2026-06-22/raw/InspireMSB_StoraOlyckor.shp',
    ),
    target: 'env.msb_stora_olyckor',
  },
  {
    id: 'msb-pfra',
    source: path.join(
      ARCHIVE,
      'Data/MSB/InspireMSB_pfra/2026-06-22/raw/InspireMSB_PFRA_PastEvent.shp',
    ),
    target: 'env.msb_pfra_pastevent',
  },
  {
    id: 'nv-naturreservat',
    source: path.join(ARCHIVE, 'Data/Naturvardsverket/naturvardsregistret/2026-07-26/raw/NR.zip'),
    target: 'env.nv_naturreservat',
    dropFirst: true,
  },
  {
    id: 'raa-byggnadsminnen',
    source: path.join(
      ARCHIVE,
      'Data/RAA/Kulturhistoriska_lamningar/2026-06-29/raw/byggnadsminnen_skyddsomraden_sverige.gpkg',
    ),
    layer: 'byggnadsminnen_skyddsomraden_sverige_polygon',
    target: 'env.byggnadsminnen',
    dropFirst: true,
  },
  {
    id: 'raa-kulturmiljo',
    source: path.join(
      ARCHIVE,
      'Data/RAA/Kulturhistoriska_lamningar/2026-06-29/raw/kulturhistoriskt_inventerad_bebyggelse_sverige.gpkg',
    ),
    layer: 'kulturhistoriskt_inventerad_bebyggelse_sverige_polygon',
    target: 'env.kulturmiljo_omrade',
    dropFirst: true,
  },
];

function run(cmd: string, args: string[], label: string): boolean {
  console.log(`\n>>> ${label}`);
  console.log(`    ${cmd} ${args.join(' ')}`);
  if (!execute) {
    console.log('    [dry-run]');
    return true;
  }
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: false });
  if (res.status !== 0) {
    console.error(`    FAILED status=${res.status}`);
    return false;
  }
  return true;
}

function psql(sql: string, label: string): boolean {
  return run(
    'docker',
    ['exec', '-i', 'miljobeslut-postgres', 'psql', '-U', 'miljobeslut', '-d', 'miljobeslut', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    label,
  );
}

function loadJob(job: Job): boolean {
  if (!fs.existsSync(job.source)) {
    console.error(`MISSING source for ${job.id}: ${job.source}`);
    return false;
  }
  const [schema, table] = job.target.split('.');
  if (job.dropFirst) {
    if (!psql(`DROP TABLE IF EXISTS ${schema}.${table} CASCADE;`, `drop ${job.target}`)) return false;
  }
  const args = [
    '-f',
    'PostgreSQL',
    PG,
    job.source,
    ...(job.layer ? [job.layer] : []),
    '-nln',
    `${schema}.${table}`,
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'FID=ogc_fid',
    '-t_srs',
    'EPSG:3006',
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-overwrite',
    '-skipfailures',
    '-progress',
  ];
  if (!run(OGR2OGR, args, `ogr2ogr → ${job.target}`)) return false;
  return psql(
    `CREATE INDEX IF NOT EXISTS ${table}_geom_gist ON ${schema}.${table} USING GIST (geom); ANALYZE ${schema}.${table};`,
    `index+analyze ${job.target}`,
  );
}

function unzipIfNeeded(zipPath: string, outDir: string): string | null {
  if (!fs.existsSync(zipPath)) return null;
  fs.mkdirSync(outDir, { recursive: true });
  const existing = fs
    .readdirSync(outDir, { recursive: true })
    .map(String)
    .find((f) => f.toLowerCase().endsWith('.shp'));
  if (existing) return path.join(outDir, existing);
  const res = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`],
    { stdio: 'inherit' },
  );
  if (res.status !== 0) return null;
  const found = fs
    .readdirSync(outDir, { recursive: true })
    .map(String)
    .find((f) => f.toLowerCase().endsWith('.shp'));
  return found ? path.join(outDir, found) : null;
}

function loadFriluft(): boolean {
  const raw = path.join(ARCHIVE, 'Data/Naturvardsverket/friluftsliv/2026-07-26/raw');
  const work = path.join(ROOT, 'storage', 'tmp', 'friluftsliv-import');
  const anordZip = path.join(raw, 'Anordningar_shp.zip');
  const lederZip = path.join(raw, 'Leder_shp.zip');
  const anordShp = unzipIfNeeded(anordZip, path.join(work, 'anordningar'));
  const lederShp = unzipIfNeeded(lederZip, path.join(work, 'leder'));

  if (!execute) {
    console.log('\n>>> friluftsliv dry-run', { anordShp, lederShp });
    return true;
  }

  psql('DROP TABLE IF EXISTS env.friluftsliv CASCADE;', 'drop env.friluftsliv');

  let ok = true;
  if (anordShp) {
    ok =
      run(OGR2OGR, [
        '-f',
        'PostgreSQL',
        PG,
        anordShp,
        '-nln',
        'env.friluftsliv',
        '-lco',
        'GEOMETRY_NAME=geom',
        '-lco',
        'FID=ogc_fid',
        '-t_srs',
        'EPSG:3006',
        '-nlt',
        'PROMOTE_TO_MULTI',
        '-overwrite',
        '-progress',
      ], 'friluftsliv anordningar') && ok;
  }
  if (lederShp) {
    // append second layer into same table if possible; else separate table
    const appendArgs = [
      '-f',
      'PostgreSQL',
      PG,
      lederShp,
      '-nln',
      'env.friluftsliv_leder',
      '-lco',
      'GEOMETRY_NAME=geom',
      '-lco',
      'FID=ogc_fid',
      '-t_srs',
      'EPSG:3006',
      '-nlt',
      'PROMOTE_TO_MULTI',
      '-overwrite',
      '-progress',
    ];
    ok = run(OGR2OGR, appendArgs, 'friluftsliv leder → env.friluftsliv_leder') && ok;
  }
  if (ok) {
    psql(
      `CREATE INDEX IF NOT EXISTS friluftsliv_geom_gist ON env.friluftsliv USING GIST (geom);
       CREATE INDEX IF NOT EXISTS friluftsliv_leder_geom_gist ON env.friluftsliv_leder USING GIST (geom);
       ANALYZE env.friluftsliv; ANALYZE env.friluftsliv_leder;`,
      'index friluft',
    );
  }
  return ok;
}

async function main() {
  console.log(execute ? 'EXECUTE mode' : 'DRY-RUN (add --execute)');
  console.log(`Archive: ${ARCHIVE}`);

  let failed = 0;
  for (const job of jobs) {
    if (!loadJob(job)) failed += 1;
  }
  if (!loadFriluft()) failed += 1;

  if (execute) {
    psql(
      `SELECT 'env.msb_stora_olyckor' t, count(*)::text c FROM env.msb_stora_olyckor
       UNION ALL SELECT 'env.msb_pfra_pastevent', count(*)::text FROM env.msb_pfra_pastevent
       UNION ALL SELECT 'env.nv_naturreservat', count(*)::text FROM env.nv_naturreservat
       UNION ALL SELECT 'env.byggnadsminnen', count(*)::text FROM env.byggnadsminnen
       UNION ALL SELECT 'env.kulturmiljo_omrade', count(*)::text FROM env.kulturmiljo_omrade
       UNION ALL SELECT 'env.friluftsliv', count(*)::text FROM env.friluftsliv
       UNION ALL SELECT 'env.friluftsliv_leder', count(*)::text FROM env.friluftsliv_leder;`,
      'verify counts',
    );
  }

  if (failed > 0) {
    console.error(`\nDone with ${failed} failure(s).`);
    process.exit(1);
  }
  console.log('\nAll archive fill jobs OK.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
