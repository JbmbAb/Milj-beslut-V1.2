/**
 * EBH ZIP → GPKG for Librarian import.
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import { buildArchiveManifestV2 } from './types/manifestSchema';

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const VERSION = new Date().toISOString().split('T')[0];

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
  });
  if (result.status !== 0) {
    throw new Error(`Failed to extract ${zipPath}: ${result.stderr || result.stdout}`);
  }
}

function findShapefile(root: string): string {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase().endsWith('.shp')) return full;
    }
  }
  throw new Error(`No shapefile found under ${root}`);
}

function main(): void {
  const harvestDirs = fs
    .readdirSync(path.join(MASTER_ARCHIVE_ROOT, 'Data', 'LST', 'EBH_Potentiellt_fororenade_omraden'))
    .filter((d) => fs.statSync(path.join(MASTER_ARCHIVE_ROOT, 'Data', 'LST', 'EBH_Potentiellt_fororenade_omraden', d)).isDirectory());

  const latest = harvestDirs.sort().at(-1);
  if (!latest) throw new Error('No EBH harvest directory found');

  const zipPath = path.join(
    MASTER_ARCHIVE_ROOT,
    'Data',
    'LST',
    'EBH_Potentiellt_fororenade_omraden',
    latest,
    'raw',
    'EBH_Potentiellt_fororenade_omraden.zip',
  );
  if (!fs.existsSync(zipPath)) throw new Error(`Missing ${zipPath}`);

  const outputDir = path.join(
    MASTER_ARCHIVE_ROOT,
    'Data',
    'LST',
    'EBH_Potentiellt_fororenade_omraden',
    VERSION,
  );
  const rawDir = path.join(outputDir, 'raw');
  const gpkgPath = path.join(rawDir, 'ebh_potentiellt_fororenade_omraden.gpkg');
  fs.mkdirSync(rawDir, { recursive: true });

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ebh-extract-'));
  try {
    extractZip(zipPath, temp);
    const shp = findShapefile(temp);
    const result = spawnSync(
      OGR2OGR_PATH,
      [
        '--config',
        'SHAPE_ENCODING',
        'CP1252',
        '-f',
        'GPKG',
        gpkgPath,
        shp,
        '-overwrite',
        '-nln',
        'ebh_potentiellt_fororenade_omraden',
        '-t_srs',
        'EPSG:3006',
        '-lco',
        'GEOMETRY_NAME=geom',
      ],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    if (result.status !== 0) {
      throw new Error(result.stderr || result.stdout);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const manifest = buildArchiveManifestV2({
    provider: 'LST',
    dataset: 'EBH_Potentiellt_fororenade_omraden',
    version: VERSION,
    total_bytes: fs.statSync(gpkgPath).size,
    files: ['raw/ebh_potentiellt_fororenade_omraden.gpkg'],
    content_bundle_sha256: sha256File(gpkgPath),
    provenance: 'ebh_zip_normalized',
    source_url:
      'https://ext-dokument.lansstyrelsen.se/Gemensamt/Geodata/Datadistribution/SWEREF99TM/EBH_Potentiellt_fororenade_omraden.zip',
    license: 'CC0',
  });
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${gpkgPath}`);
}

main();
