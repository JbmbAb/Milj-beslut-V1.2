/**
 * Normalize the MCF Lastkaj finkorniga-jordar pilot into one Librarian-ready GPKG.
 *
 * Input: archived ZIPs under GEO_Master_Archive/Data/MCF/finkorniga-jordar/<harvest>/raw
 * Output: GEO_Master_Archive/Data/MCF/finkorniga-jordar-pilot/<version>/raw/mcf_stabilitetszon_pilot.gpkg
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';

type PilotSource = {
  zipName: string;
  kommunNamn: string;
};

const PILOT_SOURCES: PilotSource[] = [
  { zipName: 'orsa-2017.zip', kommunNamn: 'Orsa' },
  { zipName: 'Enkoping.zip', kommunNamn: 'Enkoping' },
];

const HARVEST_DIR = path.join(
  MASTER_ARCHIVE_ROOT,
  'Data',
  'MCF',
  'finkorniga-jordar',
  '2026-06-25_093538',
  'raw',
);
const OUTPUT_VERSION = '2026-06-25';
const OUTPUT_DIR = path.join(
  MASTER_ARCHIVE_ROOT,
  'Data',
  'MCF',
  'finkorniga-jordar-pilot',
  OUTPUT_VERSION,
);
const RAW_OUTPUT_DIR = path.join(OUTPUT_DIR, 'raw');
const OUTPUT_GPKG = path.join(RAW_OUTPUT_DIR, 'mcf_stabilitetszon_pilot.gpkg');

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function listFilesRecursive(root: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
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
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${zipPath}: ${result.stderr || result.stdout}`);
  }
}

function findStabilityZoneShapefiles(extractedRoot: string): string[] {
  return listFilesRecursive(extractedRoot)
    .filter((filePath) => {
      const base = path.basename(filePath).toLowerCase();
      return (
        base.endsWith('.shp') &&
        (base.includes('stabilitetszon') || base.includes('stabilitetzon'))
      );
    })
    .sort((a, b) => a.localeCompare(b, 'sv'));
}

function zonTypFromShapefile(shpPath: string): number {
  const match = path.basename(shpPath).match(/zon\s*([0-9]+)|zon([0-9]+)/i);
  const raw = match?.[1] ?? match?.[2];
  const value = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`Could not infer zon_typ from ${shpPath}`);
  }
  return value;
}

function appendShapefileToGpkg(inputShp: string, source: PilotSource, first: boolean): void {
  const layerName = path.basename(inputShp, path.extname(inputShp));
  const zonTyp = zonTypFromShapefile(inputShp);
  const sql = `SELECT '${source.kommunNamn}' AS kommun_namn, ${zonTyp} AS zon_typ, '${source.zipName}' AS source_zip, * FROM "${layerName}"`;
  const args = [
    '-f',
    'GPKG',
    OUTPUT_GPKG,
    inputShp,
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
    throw new Error(`ogr2ogr failed for ${inputShp}: ${result.stderr || result.stdout}`);
  }
}

function writeManifest(): void {
  const relFile = 'raw/mcf_stabilitetszon_pilot.gpkg';
  const stat = fs.statSync(OUTPUT_GPKG);
  const manifest = buildArchiveManifestV2({
    provider: 'MCF',
    dataset: 'finkorniga-jordar-pilot',
    version: OUTPUT_VERSION,
    total_bytes: stat.size,
    files: [relFile],
    content_bundle_sha256: sha256File(OUTPUT_GPKG),
    provenance: 'mcf_lastkaj_stability_pilot_normalized',
    source_url: 'https://lastkaj.mcf.se/Karteringar/finkorniga-jordar/',
    license: 'CC0',
    expected_columns: ['kommun_namn', 'zon_typ'],
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function main(): void {
  fs.mkdirSync(RAW_OUTPUT_DIR, { recursive: true });
  fs.rmSync(OUTPUT_GPKG, { force: true });

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcf-stability-pilot-'));
  let imported = 0;
  try {
    for (const source of PILOT_SOURCES) {
      const zipPath = path.join(HARVEST_DIR, source.zipName);
      if (!fs.existsSync(zipPath)) {
        throw new Error(`Missing pilot ZIP: ${zipPath}`);
      }

      const extractDir = path.join(tempRoot, path.basename(source.zipName, '.zip'));
      console.log(`Extracting ${source.zipName}...`);
      extractZip(zipPath, extractDir);

      const shapefiles = findStabilityZoneShapefiles(extractDir);
      console.log(`  Found ${shapefiles.length} stability zone shapefile(s).`);
      for (const shp of shapefiles) {
        console.log(`  Appending ${path.basename(shp)}...`);
        appendShapefileToGpkg(shp, source, imported === 0);
        imported++;
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (imported === 0) {
    throw new Error('No stability zone shapefiles were imported.');
  }
  writeManifest();
  console.log(`Wrote ${OUTPUT_GPKG}`);
  console.log(`Imported ${imported} source shapefile(s).`);
}

main();
