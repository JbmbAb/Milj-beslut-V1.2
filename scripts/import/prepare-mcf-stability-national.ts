/**
 * Normalize MCF Lastkaj stability ZIPs → one Librarian-ready GPKG per category.
 *
 * Input:  GEO_Master_Archive/Data/MCF/<category>/<harvest>/raw/*.zip
 * Output: GEO_Master_Archive/Data/MCF/stabilitetskartering-nationell/<category>/<version>/raw/*.gpkg
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

const HARVEST_ID = process.env.MCF_HARVEST_ID || '2026-06-25_175817';
const OUTPUT_VERSION = process.env.MCF_OUTPUT_VERSION || '2026-06-26';
const ZIP_EXTRACT_TIMEOUT_MS = Number(process.env.MCF_ZIP_EXTRACT_TIMEOUT_MS || 120_000);

const CATEGORIES = [
  'finkorniga-jordar',
  'oversiktlig-stabilitetskartering-finkorniga-jordarter',
  'moran-grovkorninga-jordar',
  'oversiktlig-stabilitetskartering-i-moran-och-grova-jordar',
] as const;

type Category = (typeof CATEGORIES)[number];

type StabilityLayer = { shpPath: string; zonTyp: number };

function readArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function extractZip(zipPath: string, destination: string): void {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const command = [
    'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
    `[IO.Compression.ZipFile]::ExtractToDirectory('${zipPath.replace(/'/g, "''")}', '${destination.replace(/'/g, "''")}')`,
  ].join(' ');
  const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: ZIP_EXTRACT_TIMEOUT_MS,
  });
  if (result.error) {
    throw new Error(`Failed to extract ${zipPath}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${zipPath}: ${result.stderr || result.stdout}`);
  }
}

function listFilesRecursive(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function zonTypFromBasename(base: string): number | null {
  const patterns = [
    /stabilitetszon\s*([12])/i,
    /stabilitetzon\s*([12])/i,
    /_zon\s*([12])(?:_|\.|$)/i,
    /zon([12])(?:_|\.|$)/i,
  ];
  for (const pattern of patterns) {
    const match = base.match(pattern);
    if (match?.[1]) return Number.parseInt(match[1], 10);
  }
  return null;
}

function findStabilityZoneShapefiles(extractedRoot: string): StabilityLayer[] {
  const layers: StabilityLayer[] = [];
  for (const filePath of listFilesRecursive(extractedRoot)) {
    if (!filePath.toLowerCase().endsWith('.shp')) continue;
    const base = path.basename(filePath, '.shp');
    const lower = base.toLowerCase();
    if (!lower.includes('stabilitetszon') && !lower.includes('stabilitetzon')) continue;
    const zonTyp = zonTypFromBasename(base);
    if (zonTyp !== 1 && zonTyp !== 2) continue;
    layers.push({ shpPath: filePath, zonTyp });
  }
  return layers.sort((a, b) => a.shpPath.localeCompare(b.shpPath, 'sv'));
}

function kommunFromShapefile(shpPath: string, zipName: string): string {
  const base = path.basename(shpPath, '.shp');
  const stripped = base
    .replace(/_stabilitetszon\d+$/i, '')
    .replace(/_stabilitetzon\d+$/i, '')
    .replace(/stabilitetszon\d+$/i, '');
  if (stripped && stripped !== base) return stripped;
  return path.basename(zipName, '.zip').replace(/[-_]\d{4}$/i, '');
}

function pathsForCategory(category: Category) {
  const rawDir = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'MCF', category, HARVEST_ID, 'raw');
  const outputDir = path.join(
    MASTER_ARCHIVE_ROOT,
    'Data',
    'MCF',
    'stabilitetskartering-nationell',
    category,
    OUTPUT_VERSION,
  );
  const rawOutput = path.join(outputDir, 'raw');
  const gpkgName = `mcf_stabilitetszon_${category.replace(/[^a-z0-9]+/gi, '_')}.gpkg`;
  const outputGpkg = path.join(rawOutput, gpkgName);
  const checkpointPath = path.join(outputDir, '.normalize-checkpoint.json');
  return { rawDir, outputDir, rawOutput, outputGpkg, gpkgName, checkpointPath };
}

type Checkpoint = { doneZips: string[]; importedLayers: number };

function loadCheckpoint(checkpointPath: string): Checkpoint {
  if (!fs.existsSync(checkpointPath)) return { doneZips: [], importedLayers: 0 };
  const raw = JSON.parse(fs.readFileSync(checkpointPath, 'utf8')) as Partial<Checkpoint>;
  return { doneZips: raw.doneZips ?? [], importedLayers: raw.importedLayers ?? 0 };
}

function saveCheckpoint(checkpointPath: string, checkpoint: Checkpoint): void {
  fs.writeFileSync(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}

function appendLayer(
  sourcePath: string,
  category: Category,
  kommunNamn: string,
  zonTyp: number,
  sourceZip: string,
  first: boolean,
  outputGpkg: string,
): boolean {
  const layerName = path.basename(sourcePath, path.extname(sourcePath));
  const sql = `SELECT '${kommunNamn.replace(/'/g, "''")}' AS kommun_namn, ${zonTyp} AS zon_typ, '${category.replace(/'/g, "''")}' AS kategori, '${sourceZip.replace(/'/g, "''")}' AS source_zip, * FROM "${layerName.replace(/"/g, '""')}"`;
  const args = [
    '-f',
    'GPKG',
    outputGpkg,
    sourcePath,
    first ? '-overwrite' : '-append',
    '-nln',
    'stabilitetszon',
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-dim',
    'XY',
    '-t_srs',
    'EPSG:3006',
    '-lco',
    'GEOMETRY_NAME=geom',
    '-lco',
    'SPATIAL_INDEX=NO',
    '-dialect',
    'OGRSQL',
    '-sql',
    sql,
  ];
  const result = spawnSync(OGR2OGR_PATH, args, { encoding: 'utf8', stdio: 'pipe' });
  if (result.status !== 0) {
    console.warn(`  ogr2ogr skip ${path.basename(sourcePath)}: ${(result.stderr || result.stdout).slice(0, 200)}`);
    return false;
  }
  return true;
}

function writeManifest(outputDir: string, category: Category, gpkgRel: string, gpkgPath: string): void {
  const stat = fs.statSync(gpkgPath);
  const manifest = buildArchiveManifestV2({
    provider: 'MCF',
    dataset: `stabilitetskartering-nationell/${category}`,
    version: OUTPUT_VERSION,
    total_bytes: stat.size,
    files: [gpkgRel],
    content_bundle_sha256: sha256File(gpkgPath),
    provenance: 'mcf_lastkaj_stability_national_normalized',
    source_url: `https://lastkaj.mcf.se/Karteringar/${category}/`,
    license: 'CC0',
    expected_columns: ['kommun_namn', 'zon_typ', 'kategori', 'source_zip'],
  });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function normalizeCategory(category: Category): void {
  const { rawDir, outputDir, rawOutput, outputGpkg, gpkgName, checkpointPath } =
    pathsForCategory(category);

  if (!fs.existsSync(rawDir)) {
    throw new Error(`Missing harvest raw dir: ${rawDir}`);
  }

  fs.mkdirSync(rawOutput, { recursive: true });
  const checkpoint = loadCheckpoint(checkpointPath);
  const done = new Set(checkpoint.doneZips);
  let importedLayers = checkpoint.importedLayers;

  const zipFiles = fs
    .readdirSync(rawDir)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .sort((a, b) => a.localeCompare(b, 'sv'));

  console.log(`\n=== ${category}: ${zipFiles.length} ZIP(s), resume ${done.size} done ===`);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcf-stability-'));
  let processed = 0;

  try {
    for (const zipName of zipFiles) {
      if (done.has(zipName)) {
        processed++;
        continue;
      }

      const zipPath = path.join(rawDir, zipName);
      processed++;
      console.log(`[${processed}/${zipFiles.length}] ${zipName}`);

      const extractDir = path.join(tempRoot, path.basename(zipName, '.zip'));
      let layerCount = 0;

      try {
        extractZip(zipPath, extractDir);
        const shapefiles = findStabilityZoneShapefiles(extractDir);
        for (const layer of shapefiles) {
          const kommunNamn = kommunFromShapefile(layer.shpPath, zipName);
          const ok = appendLayer(
            layer.shpPath,
            category,
            kommunNamn,
            layer.zonTyp,
            zipName,
            importedLayers === 0,
            outputGpkg,
          );
          if (ok) {
            importedLayers++;
            layerCount++;
          }
        }
      } catch (err) {
        console.warn(`  Extract/import failed: ${err instanceof Error ? err.message : err}`);
      } finally {
        fs.rmSync(extractDir, { recursive: true, force: true });
      }

      if (layerCount === 0) {
        console.warn(`  No Stabilitetszon layers in ${zipName}`);
      }

      checkpoint.doneZips.push(zipName);
      checkpoint.importedLayers = importedLayers;
      saveCheckpoint(checkpointPath, checkpoint);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (!fs.existsSync(outputGpkg) || importedLayers === 0) {
    console.warn(
      `SKIP ${category}: no stability layers imported (${importedLayers}). Documented gap; continuing pipeline.`,
    );
    fs.writeFileSync(
      path.join(outputDir, '.normalize-skipped.json'),
      `${JSON.stringify({ category, reason: 'no_layers', at: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
    return;
  }

  writeManifest(outputDir, category, `raw/${gpkgName}`, outputGpkg);
  console.log(`Wrote ${outputGpkg} (${importedLayers} layers)`);
}

function main(): void {
  const only = readArg('category');
  const selected = only ? CATEGORIES.filter((c) => c === only) : [...CATEGORIES];

  if (selected.length === 0) {
    throw new Error(`Unknown category: ${only}`);
  }

  console.log(`MCF national normalize | harvest=${HARVEST_ID} version=${OUTPUT_VERSION}`);
  for (const category of selected) {
    normalizeCategory(category);
  }
  console.log('\nAll selected categories normalized.');
}

main();
