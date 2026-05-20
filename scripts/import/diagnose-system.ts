/**
 * System Diagnostics for Bulk Geodata Import
 * Run: tsx scripts/import/diagnose-system.ts
 *
 * Checks disk space, RAM, CPU, PostgreSQL, GDAL, drive availability,
 * running processes, and gives concrete PASS/FAIL/WARN recommendations
 * for a 100M–500M row PostgreSQL geodata import on Windows.
 */

import { execSync, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[1;31m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function ok(msg: string)   { console.log(`  ${GREEN}✅ ${msg}${RESET}`); }
function warn(msg: string) { console.log(`  ${YELLOW}⚠️  ${msg}${RESET}`); }
function fail(msg: string) { console.log(`  ${RED}❌ ${msg}${RESET}`); }
function info(msg: string) { console.log(`  ${CYAN}ℹ  ${msg}${RESET}`); }
function header(msg: string) { console.log(`\n${BOLD}${CYAN}── ${msg} ──────────────────────────────────────${RESET}`); }

function gb(bytes: bigint | number): string {
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  return (n / 1e9).toFixed(1) + ' GB';
}

function runCmd(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch {
    return '';
  }
}

// ── 1. DISK SPACE ──────────────────────────────────────────────────
header('1. DISK SPACE');

interface DiskInfo { device: string; free: number; total: number; name: string; }
const drives: DiskInfo[] = [];

try {
  const raw = runCmd('wmic logicaldisk get DeviceID,FreeSpace,Size,VolumeName /format:csv');
  const lines = raw.split('\n').filter(l => l.trim() && !l.startsWith('Node'));
  for (const line of lines) {
    const parts = line.split(',');
    // CSV: Node,DeviceID,FreeSpace,Size,VolumeName
    if (parts.length >= 5) {
      const device = parts[1]?.trim();
      const free   = parseInt(parts[2]?.trim() || '0', 10) || 0;
      const total  = parseInt(parts[3]?.trim() || '0', 10) || 0;
      const name   = parts[4]?.trim() || '';
      if (device && total > 0) drives.push({ device, free, total, name });
    }
  }
} catch { /* wmic unavailable */ }

const DRIVES_OF_INTEREST = ['C:', 'D:', 'E:', 'F:'];
let mainDiskFreeGB = 0;

for (const d of drives) {
  const freeGB = d.free / 1e9;
  const totalGB = d.total / 1e9;
  const usedPct = Math.round(((d.total - d.free) / d.total) * 100);
  const label = `${d.device} ${d.name ? `(${d.name})` : ''}`.trim();

  if (d.device === 'C:') mainDiskFreeGB = freeGB;

  if (freeGB < 20) {
    fail(`${label}: ${gb(d.free)} free / ${gb(d.total)} total  [${usedPct}% used] ← CRITICALLY LOW`);
  } else if (freeGB < 100) {
    warn(`${label}: ${gb(d.free)} free / ${gb(d.total)} total  [${usedPct}% used]`);
  } else {
    ok(`${label}: ${gb(d.free)} free / ${gb(d.total)} total  [${usedPct}% used]`);
  }
}

if (drives.length === 0) {
  warn('Kunde inte läsa diskinfo via wmic. Kör check-prerequisites.bat manuellt.');
}

// RAW COPY DECISION
console.log();
const hasD = drives.some(d => d.device === 'D:' && d.free / 1e9 > 200);
const hasE = drives.some(d => d.device === 'E:');
const dFreeGB = drives.find(d => d.device === 'D:')?.free ?? 0;
const eFreeGB = drives.find(d => d.device === 'E:')?.free ?? 0;

console.log(`  ${BOLD}📦 Råkopia (GPKG) beslut:${RESET}`);
// Estimated GPKG sizes for all 14 collections: ~80–150 GB
const estGpkgGB = 120;
const estPostGiSGB = 400; // ~3–4x compression ratio in PostgreSQL

info(`Estimat GPKG-råkopior (14 samlingar): ~${estGpkgGB} GB`);
info(`Estimat PostgreSQL-storlek (100M rader med GiST): ~${estPostGiSGB} GB`);
console.log();

const bestDownloadDrive = drives.sort((a, b) => b.free - a.free)[0];
if (bestDownloadDrive && bestDownloadDrive.free / 1e9 > estGpkgGB + 50) {
  ok(`Råkopia REKOMMENDERAS – spara på ${bestDownloadDrive.device} (${gb(bestDownloadDrive.free)} fritt)`);
  ok(`Flagga: --keep-downloads  →  sparar GPKG-filer efter import`);
  ok(`Fördel: snabb re-import utan ny nedladdning (Lantmäteriet rate-limits)`);
} else {
  warn(`Begränsat diskutrymme – råkopia REKOMMENDERAS EJ`);
  warn(`Flagga: utelämna --keep-downloads  →  GPKG raderas direkt efter import`);
}

// ── 2. RAM ─────────────────────────────────────────────────────────
header('2. RAM');
const totalRAM = os.totalmem();
const freeRAM  = os.freemem();
const totalGB  = totalRAM / 1e9;
const freeGB   = freeRAM  / 1e9;

info(`Total: ${totalGB.toFixed(1)} GB`);
if (freeGB >= 8) {
  ok(`Fritt: ${freeGB.toFixed(1)} GB  → tillräckligt för maintenance_work_mem=4GB`);
} else if (freeGB >= 4) {
  warn(`Fritt: ${freeGB.toFixed(1)} GB  → stäng applikationer för att frigöra minne`);
  warn(`Sänk till: maintenance_work_mem=2GB i optimize-for-import.sql`);
} else {
  fail(`Fritt: ${freeGB.toFixed(1)} GB  → kritiskt lågt! Import kan crasha.`);
  fail(`Stäng browsers, IDEs och alla icke-nödvändiga program NU.`);
}

// ── 3. CPU ─────────────────────────────────────────────────────────
header('3. CPU');
const cpus = os.cpus();
const cores = cpus.length;
const model = cpus[0]?.model?.trim() ?? 'Okänd';
info(`${model}`);
if (cores >= 8) {
  ok(`${cores} logiska kärnor → max_parallel_maintenance_workers=4 är säkert`);
} else if (cores >= 4) {
  ok(`${cores} logiska kärnor → max_parallel_maintenance_workers=2 rekommenderat`);
} else {
  warn(`${cores} logiska kärnor → sätt max_parallel_maintenance_workers=1`);
}

// ── 4. POSTGRESQL ──────────────────────────────────────────────────
header('4. POSTGRESQL');
const pgReady = runCmd('pg_isready -h localhost -p 5432');
if (pgReady.includes('accepting connections')) {
  ok(`PostgreSQL svarar på localhost:5432`);
} else {
  fail(`PostgreSQL svarar INTE på localhost:5432 – starta innan import!`);
}

// PostgreSQL version
const pgVer = runCmd('psql -h localhost -p 5432 -U postgres -c "SELECT version();" -t 2>&1');
if (pgVer && !pgVer.includes('error') && !pgVer.includes('fatal')) {
  const versionLine = pgVer.split('\n').find(l => l.includes('PostgreSQL'));
  ok(`Version: ${versionLine?.trim() ?? pgVer.substring(0, 80)}`);
}

// Check if PostGIS is installed
const postgis = runCmd('psql -h localhost -p 5432 -U postgres -d miljobeslut -c "SELECT PostGIS_Version();" -t 2>&1');
if (postgis && postgis.includes('.')) {
  ok(`PostGIS: ${postgis.trim().substring(0, 60)}`);
} else {
  fail(`PostGIS SAKNAS i databasen 'miljobeslut' – kör: CREATE EXTENSION postgis;`);
}

// Check pgvector
const pgvec = runCmd('psql -h localhost -p 5432 -U postgres -d miljobeslut -c "SELECT extversion FROM pg_extension WHERE extname=\'vector\';" -t 2>&1');
if (pgvec && pgvec.match(/\d+\.\d+/)) {
  ok(`pgvector: ${pgvec.trim()}`);
} else {
  warn(`pgvector inte installerat (behövs för AI-embeddings men inte för geodata-import)`);
}

// ── 5. GDAL ───────────────────────────────────────────────────────
header('5. GDAL');
const gdalPath = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
if (fs.existsSync(gdalPath)) {
  const ver = runCmd(`"${gdalPath}" --version`);
  if (ver) ok(`ogr2ogr: ${ver}`);
  else ok(`ogr2ogr hittad på ${gdalPath}`);

  // Check PostgreSQL driver
  const drivers = runCmd(`"${gdalPath}" --formats 2>&1`);
  if (drivers.includes('PostgreSQL')) {
    ok(`PostgreSQL driver tillgänglig i GDAL`);
  } else {
    fail(`PostgreSQL driver SAKNAS i GDAL-installationen – installera OSGeo4W med PostgreSQL-driver`);
  }
  if (drivers.includes('GPKG')) {
    ok(`GPKG driver tillgänglig`);
  }
} else {
  fail(`ogr2ogr INTE HITTAD på ${gdalPath}`);
  fail(`Installera GDAL från: https://trac.osgeo.org/osgeo4w/`);
}

// ── 6. ENHETER ────────────────────────────────────────────────────
header('6. ENHETER & KATALOGER');

const pathsToCheck = [
  { path: 'E:\\MiljoBeslut_Produktdata_Sources', desc: 'E: källdata (NV shapefile)', required: false },
  { path: 'D:\\ingest-arkiv-2026-03-29',         desc: 'D: import-arkiv',            required: false },
  { path: path.resolve('storage/ingest/platform-downloads'), desc: 'GPKG nedladdningskatalog', required: false },
  { path: path.resolve('prisma'),                 desc: 'Prisma-schema',              required: true  },
  { path: path.resolve('scripts/db'),             desc: 'DB-skript',                 required: true  },
];

for (const p of pathsToCheck) {
  if (fs.existsSync(p.path)) {
    try {
      const stat = fs.statSync(p.path);
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(p.path).length;
        ok(`${p.path}  (${entries} filer/mappar)`);
      } else {
        ok(`${p.path}  (fil)`);
      }
    } catch {
      ok(`${p.path}  ✓`);
    }
  } else {
    if (p.required) {
      fail(`SAKNAS: ${p.path}  (${p.desc})`);
    } else {
      warn(`Finns ej: ${p.path}  (${p.desc})`);
      if (p.path.includes('platform-downloads')) {
        info(`→ Skapas automatiskt av import-skriptet`);
      }
    }
  }
}

// ── 7. PROCESSER (top memory) ─────────────────────────────────────
header('7. PROCESSER MED HÖG RAM-ANVÄNDNING');
const processOut = runCmd('wmic process get Name,WorkingSetSize /format:csv');
interface Proc { name: string; mb: number; }
const procs: Proc[] = [];

for (const line of processOut.split('\n')) {
  const parts = line.split(',');
  if (parts.length >= 3) {
    const name = parts[2]?.trim();
    const wss  = parseInt(parts[1]?.trim() || '0', 10) || 0;
    if (name && wss > 0) procs.push({ name, mb: Math.round(wss / 1024 / 1024) });
  }
}

procs.sort((a, b) => b.mb - a.mb);
const canClose = ['chrome', 'firefox', 'msedge', 'teams', 'slack', 'discord', 'zoom', 'outlook', 'spotify'];
let topProcs = procs.slice(0, 25);

for (const p of topProcs) {
  const shouldClose = canClose.some(c => p.name.toLowerCase().includes(c));
  const tag = shouldClose ? ` ${YELLOW}← STÄNG!${RESET}` : '';
  const color = p.mb > 500 ? YELLOW : RESET;
  console.log(`  ${color}${p.name.padEnd(35)} ${String(p.mb).padStart(6)} MB${tag}${RESET}`);
}

// ── 8. INDEXERINGSKONTROLL ─────────────────────────────────────────
header('8. INDEXERINGSSTRATEGI FÖR 500M RADER');

console.log(`
  ${BOLD}Tabell-storleksuppskattning (14 samlingar, 100M initialt):${RESET}
  ┌─────────────────────────────────────────┬──────────┬───────────┐
  │ Samling                                 │ Rader    │ PG-storlek│
  ├─────────────────────────────────────────┼──────────┼───────────┤
  │ registerenhetsomradesytor (LM)          │ ~30M     │ ~120 GB   │
  │ registerenhetsomradeslinjer (LM)        │ ~20M     │ ~80 GB    │
  │ lm_mark (topografi)                     │ ~15M     │ ~60 GB    │
  │ lm_byggnad (topografi)                  │ ~12M     │ ~50 GB    │
  │ sgu_soil_type_25k_100k                  │ ~5M      │ ~20 GB    │
  │ sgu_well                                │ ~2M      │ ~8 GB     │
  │ sgu_ground_layer_1m                     │ ~3M      │ ~12 GB    │
  │ Övriga 7 samlingar                      │ ~13M     │ ~50 GB    │
  ├─────────────────────────────────────────┼──────────┼───────────┤
  │ TOTALT (fas 1)                          │ ~100M    │ ~400 GB   │
  └─────────────────────────────────────────┴──────────┴───────────┘

  ${BOLD}Indexstrategi:${RESET}
  • GiST (geom)    → Spatial queries – alla tabeller
  • BRIN (ogc_fid) → Sekventiella tabeller >5M rader – 1000x mindre än B-tree
  • B-tree         → beteckning, kommunnamn, trakt
  • fillfactor=80  → Lämnar plats för uppdateringar utan page-splits

  ${BOLD}BRIN vs GiST beslut:${RESET}
  • BRIN INDEX storlek: ~1 MB per 10M rader
  • GiST INDEX storlek: ~1 GB per 10M rader (geometri)
  → Använd BRIN på ogc_fid (insert-ordning), GiST på geom (spatial)

  ${BOLD}Kör efter import:${RESET}
  psql -h localhost -p 5432 -U postgres -d miljobeslut \\
    -f scripts/db/post-import-indexing.sql
`);

// ── 9. SAMMANFATTNING ──────────────────────────────────────────────
header('9. ÅTGÄRDSLISTA FÖRE IMPORT');

console.log(`
  ${BOLD}Obligatoriskt:${RESET}
  □ Stäng Chrome/Edge/Firefox (frigör RAM)
  □ Stäng Teams/Slack/Discord/Zoom (frigör RAM)
  □ Verifiera PostgreSQL kör:   pg_isready -h localhost -p 5432
  □ Kör PostgreSQL-tuning:      psql -U postgres -d miljobeslut -f scripts/db/optimize-for-import.sql
  □ Skapa nedladdningskatalog:  mkdir storage\\ingest\\platform-downloads

  ${BOLD}Kommandoordning:${RESET}
  1. Stäng onödiga appar (se lista ovan)
  2. psql -U postgres -d miljobeslut -f scripts\\db\\optimize-for-import.sql
  3. tsx scripts\\import\\bulk-import-platform-all.ts --download-first${bestDownloadDrive && bestDownloadDrive.free / 1e9 > estGpkgGB + 50 ? ' --keep-downloads' : ''}
  4. psql -U postgres -d miljobeslut -f scripts\\db\\post-import-indexing.sql

  ${BOLD}Diskutrymme-rekommendation:${RESET}
  ${bestDownloadDrive && bestDownloadDrive.free / 1e9 > estGpkgGB + 50
    ? `✅ SPARA råkopior (--keep-downloads) på ${bestDownloadDrive.device} – ${gb(bestDownloadDrive.free)} fritt`
    : `⚠️  RADERA råkopior (utelämna --keep-downloads) – för lite diskutrymme`
  }
`);

console.log(`${BOLD}${GREEN}=== Diagnostik klar ===${RESET}\n`);
