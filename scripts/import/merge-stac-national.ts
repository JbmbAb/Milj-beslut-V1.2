/**
 * Väg B — STAC pre-processing: merge 290 kommun-ZIP → nationell GeoPackage + manifest v2.
 *
 * Input:  GEO_Master_Archive/Data/LM/STAC_Archive/<collection>/*.zip
 * Output: GEO_Master_Archive/Data/Lantmateriet/<dataset>/<version>/raw/<output.gpkg>
 *         + manifest.json (schema v2, expected_columns from importRegistry)
 *
 * Usage:
 *   npx tsx scripts/import/merge-stac-national.ts --stac-folder fastighetsindelning --version 2026-06-18
 *   npx tsx scripts/import/merge-stac-national.ts --dataset "Fastighetsindelning_Nationell/Registerenhetsomradesytor" --version 2026-06-18 --execute
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { MASTER_ARCHIVE_ROOT } from './config/mimersBrunn';
import {
  listStacMergeProfiles,
  resolveStacMergeEntry,
  resolveStacMergeEntryByDataset,
  type ImportRegistryEntry,
  type StacMergeProfile,
} from './config/importRegistry';
import { buildArchiveManifestV2, type ArchiveManifestV2 } from './types/manifestSchema';
import { canOpenOgrSource, listOgrLayerNames, resolveGpkgSource } from './lastkajenImportEngine';

dotenv.config();

const OGR2OGR_PATH = process.env.OGR2OGR_PATH || 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
const STAC_ARCHIVE_ROOT = path.join(MASTER_ARCHIVE_ROOT, 'Data', 'LM', 'STAC_Archive');

type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  dry: (msg: string) => void;
};

const logger: Logger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${msg}`),
  error: (msg, err) => console.error(`[ERROR] ${msg}`, err ?? ''),
  dry: (msg) => console.log(`[DRY-RUN] ${msg}`),
};

function parseArgs(argv: string[]): {
  stacFolder: string;
  dataset: string;
  version: string;
  execute: boolean;
  resume: boolean;
  parallel: number;
  flat: boolean;
} {
  let stacFolder = '';
  let dataset = '';
  let version = new Date().toISOString().slice(0, 10);
  let execute = false;
  let resume = false;
  let parallel = 1;
  let flat = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--stac-folder') stacFolder = argv[++i] ?? '';
    else if (arg === '--dataset') dataset = argv[++i] ?? '';
    else if (arg === '--version') version = argv[++i] ?? version;
    else if (arg === '--execute') execute = true;
    else if (arg === '--resume') resume = true;
    else if (arg === '--flat') flat = true;
    else if (arg === '--parallel') parallel = Math.max(1, Number.parseInt(argv[++i] ?? '1', 10) || 1);
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  npx tsx scripts/import/merge-stac-national.ts --stac-folder fastighetsindelning --version YYYY-MM-DD [--execute] [--resume] [--flat]
  npx tsx scripts/import/merge-stac-national.ts --dataset "Fastighetsindelning_Nationell/Registerenhetsomradesytor" --version YYYY-MM-DD [--execute]

Known STAC folders: ${listStacMergeProfiles()
        .map((p) => p.profile.stac_archive_folder)
        .join(', ')}`);
      process.exit(0);
    }
  }

  if (!stacFolder && dataset) {
    const match = resolveStacMergeEntryByDataset(dataset);
    if (!match) {
      throw new Error(`No STAC merge profile for dataset "${dataset}"`);
    }
    stacFolder = match.profile.stac_archive_folder;
  }

  if (!stacFolder) {
    throw new Error('Provide --stac-folder <name> or --dataset <Lantmateriet/...>');
  }

  return { stacFolder, dataset, version, execute, resume, parallel, flat };
}

function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(8 * 1024 * 1024);
    let offset = 0;
    while (true) {
      const bytesRead = fs.readSync(fd, buf, 0, buf.length, offset);
      if (bytesRead === 0) break;
      hash.update(bytesRead === buf.length ? buf : buf.subarray(0, bytesRead));
      offset += bytesRead;
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function bundleHash(filePaths: string[]): string {
  const parts = filePaths
    .slice()
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'sv'))
    .map((fp) => `${path.basename(fp)}:${sha256File(fp)}`);
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

function listZipFiles(sourceDir: string): string[] {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`STAC source directory not found: ${sourceDir}`);
  }
  return fs
    .readdirSync(sourceDir)
    .filter((name) => name.toLowerCase().endsWith('.zip') && !/kvitto/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'sv'))
    .map((name) => path.join(sourceDir, name));
}

function isZipArchiveComplete(zipPath: string): boolean {
  let retries = 3;
  while (retries > 0) {
    try {
      const fd = fs.openSync(zipPath, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        if (size < 22) return false;
        const tailSize = Math.min(size, 65536);
        const buf = Buffer.alloc(tailSize);
        fs.readSync(fd, buf, 0, tailSize, size - tailSize);
        return buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
      } finally {
        fs.closeSync(fd);
      }
    } catch (err: any) {
      retries--;
      if (retries === 0) throw err;
      console.warn(`[WARN] Error reading ${path.basename(zipPath)} from cloud drive, retrying in 2s... (Attempts remaining: ${retries}) Error: ${err.message}`);
      spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2']);
    }
  }
  return false;
}

function stacInnerGpkgName(zipPath: string, stacArchiveFolder: string): string {
  const kn = path.basename(zipPath, '.zip');
  if (stacArchiveFolder === 'fastighetsindelning') {
    return `fastighetsindelning_kn${kn}.gpkg`;
  }
  if (stacArchiveFolder === 'byggnader') {
    return `byggnader_kn${kn}.gpkg`;
  }
  if (stacArchiveFolder === 'marktacke') {
    return `marktacke_kn${kn}.gpkg`;
  }
  return `${stacArchiveFolder}_kn${kn}.gpkg`;
}

function mergeZipIntoGpkg(
  zipPath: string,
  outputGpkg: string,
  profile: StacMergeProfile,
  first: boolean,
): void {
  const innerHint = (zipBase: string) => stacInnerGpkgName(zipBase.endsWith('.zip') ? zipBase : `${zipBase}.zip`, profile.stac_archive_folder);
  const resolved = resolveGpkgSource(zipPath, innerHint);
  try {
    const mode = first ? '-overwrite' : '-append';
    const args = [
      OGR2OGR_PATH,
      '-f',
      'GPKG',
      outputGpkg,
      resolved.sourcePath,
      profile.ogr_layer,
      mode,
      '-nln',
      profile.ogr_layer,
      '-nlt',
      'PROMOTE_TO_MULTI',
      '-t_srs',
      'EPSG:3006',
      '-lco',
      'SPATIAL_INDEX=NO',
      '-gt',
      '65536',
    ];
    const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8', stdio: 'pipe', maxBuffer: 50 * 1024 * 1024 });
    if (result.status !== 0) {
      throw new Error(
        `ogr2ogr ${mode} failed for ${path.basename(zipPath)}: ${result.stderr || result.stdout}`,
      );
    }
  } finally {
    resolved.cleanup();
  }
}

function checkpointPath(versionDir: string): string {
  return path.join(versionDir, 'merge-checkpoint.json');
}

function loadCheckpoint(versionDir: string): Set<string> {
  const cp = checkpointPath(versionDir);
  if (!fs.existsSync(cp)) return new Set();
  const parsed = JSON.parse(fs.readFileSync(cp, 'utf8')) as { completed?: string[] };
  return new Set(parsed.completed ?? []);
}

function saveCheckpoint(versionDir: string, completed: Set<string>): void {
  fs.writeFileSync(
    checkpointPath(versionDir),
    JSON.stringify({ completed: [...completed].sort(), updated_at: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

function failuresPath(versionDir: string): string {
  return path.join(versionDir, 'merge-failures.json');
}

function loadFailures(versionDir: string): Map<string, string> {
  const fp = failuresPath(versionDir);
  if (!fs.existsSync(fp)) return new Map();
  const parsed = JSON.parse(fs.readFileSync(fp, 'utf8')) as { failures?: Array<{ zip: string; error: string }> };
  return new Map((parsed.failures ?? []).map((f) => [f.zip, f.error]));
}

function saveFailures(versionDir: string, failures: Map<string, string>): void {
  fs.writeFileSync(
    failuresPath(versionDir),
    JSON.stringify(
      {
        failures: [...failures.entries()].map(([zip, error]) => ({ zip, error })).sort((a, b) => a.zip.localeCompare(b.zip, 'sv')),
        updated_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );
}

function writeManifest(
  versionDir: string,
  rawDir: string,
  provider: string,
  dataset: string,
  version: string,
  entry: ImportRegistryEntry,
  profile: StacMergeProfile,
  relFile: string,
): void {
  const fullPath = path.join(rawDir, profile.output_gpkg);
  const content_bundle_sha256 = bundleHash([fullPath]);
  const manifest = buildArchiveManifestV2({
    provider,
    dataset,
    version,
    total_bytes: fs.statSync(fullPath).size,
    files: [relFile],
    content_bundle_sha256,
    provenance: 'stac_national_merge',
    source_url: entry.source_url,
    license: entry.license,
    qa_status: 'pending',
    expected_columns: [...entry.expected_columns],
  });

  fs.writeFileSync(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

function validateSampleVsi(zipPath: string, profile: StacMergeProfile, log: Logger): void {
  const resolved = resolveGpkgSource(zipPath);
  try {
    log.info(`  VSI probe: ${resolved.sourcePath}`);
    if (!canOpenOgrSource(resolved.sourcePath)) {
      throw new Error('ogrinfo cannot open resolved VSI path');
    }
    const layers = listOgrLayerNames(resolved.sourcePath);
    if (!layers.includes(profile.ogr_layer)) {
      throw new Error(
        `Layer "${profile.ogr_layer}" not found in ${path.basename(zipPath)}. Layers: ${layers.join(', ')}`,
      );
    }
    log.info(`  VSI OK — layer "${profile.ogr_layer}" present (${layers.length} layers in zip)`);
  } finally {
    resolved.cleanup();
  }
}

function previewManifestDraft(
  provider: string,
  dataset: string,
  version: string,
  entry: ImportRegistryEntry,
  profile: StacMergeProfile,
  relFile: string,
): ArchiveManifestV2 {
  return buildArchiveManifestV2({
    provider,
    dataset,
    version,
    total_bytes: 0,
    files: [relFile],
    content_bundle_sha256: '0'.repeat(64),
    provenance: 'stac_national_merge',
    source_url: entry.source_url,
    license: entry.license,
    qa_status: 'pending',
    expected_columns: [...entry.expected_columns],
  });
}

export async function mergeStacNational(options: {
  stacFolder: string;
  dataset?: string;
  version: string;
  execute?: boolean;
  resume?: boolean;
  flat?: boolean;
  log?: Logger;
}): Promise<{ outputGpkg: string; manifestPath: string; zipCount: number; mergedCount: number }> {
  const log = options.log ?? logger;
  const resolved =
    (options.dataset ? resolveStacMergeEntryByDataset(options.dataset) : null) ??
    resolveStacMergeEntry(options.stacFolder, options.dataset);
  if (!resolved) {
    throw new Error(
      `Unknown STAC merge target (folder="${options.stacFolder}" dataset="${options.dataset ?? ''}"). ` +
        `Known folders: ${[...new Set(listStacMergeProfiles().map((p) => p.profile.stac_archive_folder))].join(', ')}`,
    );
  }

  const { provider, dataset, entry, profile } = resolved;

  const sourceDir = path.join(STAC_ARCHIVE_ROOT, profile.stac_archive_folder);
  const versionDir = path.join(MASTER_ARCHIVE_ROOT, 'Data', provider, dataset, options.version);
  const rawDir = options.flat ? versionDir : path.join(versionDir, 'raw');
  const relFile = options.flat ? profile.output_gpkg : path.posix.join('raw', profile.output_gpkg);
  const outputGpkg = path.join(rawDir, profile.output_gpkg);
  const zipFiles = listZipFiles(sourceDir);

  log.info(`STAC merge: ${profile.stac_archive_folder} → ${provider}/${dataset}/${options.version}`);
  log.info(`  Source: ${sourceDir} (${zipFiles.length} zip)`);
  log.info(`  Target: ${outputGpkg}`);
  log.info(`  PostGIS: ${entry.target_schema}.${entry.target_table}`);
  log.info(`  Layer:  ${profile.ogr_layer}`);
  log.info(`  Expected columns (${entry.expected_columns.length}): ${entry.expected_columns.join(', ')}`);

  if (!options.execute) {
    log.info(`  Sample zip: ${path.basename(zipFiles[0] ?? 'n/a')}`);
    if (zipFiles[0]) {
      validateSampleVsi(zipFiles[0], profile, log);
    }
    const manifestDraft = previewManifestDraft(provider, dataset, options.version, entry, profile, relFile);
    log.dry(`Would merge ${zipFiles.length} zip files into ${outputGpkg}`);
    log.dry(`Would write manifest v2 at ${path.join(versionDir, 'manifest.json')}`);
    log.info('  Manifest v2 draft (plan):');
    console.log(
      JSON.stringify(
        {
          schema_version: manifestDraft.schema_version,
          provider: manifestDraft.provider,
          dataset: manifestDraft.dataset,
          version: manifestDraft.version,
          qa_status: manifestDraft.qa_status,
          provenance: manifestDraft.provenance,
          files: manifestDraft.files,
          expected_columns: manifestDraft.expected_columns,
          postgis_target: `${entry.target_schema}.${entry.target_table}`,
          source_url: manifestDraft.source_url,
        },
        null,
        2,
      ),
    );
    return {
      outputGpkg,
      manifestPath: path.join(versionDir, 'manifest.json'),
      zipCount: zipFiles.length,
      mergedCount: 0,
    };
  }

  fs.mkdirSync(rawDir, { recursive: true });
  const completed = options.resume ? loadCheckpoint(versionDir) : new Set<string>();
  const failures = options.resume ? loadFailures(versionDir) : new Map<string, string>();
  let first = completed.size === 0 && !fs.existsSync(outputGpkg);
  let mergedCount = 0;

  for (let i = 0; i < zipFiles.length; i++) {
    const zipPath = zipFiles[i];
    const zipName = path.basename(zipPath);
    if (completed.has(zipName)) {
      continue;
    }

    const previouslyFailed = failures.has(zipName);
    if (previouslyFailed && !isZipArchiveComplete(zipPath)) {
      continue;
    }
    if (previouslyFailed) {
      log.info(`  [${i + 1}/${zipFiles.length}] ${zipName} (retry after reharvest)`);
    } else {
      log.info(`  [${i + 1}/${zipFiles.length}] ${zipName}`);
    }

    if (!isZipArchiveComplete(zipPath)) {
      const msg = 'ZIP appears truncated or corrupt (missing end-of-central-directory)';
      log.warn(`   ⚠ SKIP ${zipName}: ${msg}`);
      failures.set(zipName, msg);
      saveFailures(versionDir, failures);
      continue;
    }

    try {
      mergeZipIntoGpkg(zipPath, outputGpkg, profile, first);
      first = false;
      completed.add(zipName);
      failures.delete(zipName);
      mergedCount += 1;
      saveCheckpoint(versionDir, completed);
      if (previouslyFailed) {
        saveFailures(versionDir, failures);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`   ⚠ SKIP ${zipName}: ${msg.split('\n')[0]}`);
      failures.set(zipName, msg);
      saveFailures(versionDir, failures);
    }
  }

  if (!fs.existsSync(outputGpkg)) {
    throw new Error('Merge produced no output GPKG');
  }

  writeManifest(versionDir, rawDir, provider, dataset, options.version, entry, profile, relFile);
  log.info(`✅ Wrote ${path.join(versionDir, 'manifest.json')} (${mergedCount} new zip this run)`);
  if (failures.size > 0) {
    log.warn(`⚠ ${failures.size} zip(s) skipped — see ${failuresPath(versionDir)}`);
  }

  return {
    outputGpkg,
    manifestPath: path.join(versionDir, 'manifest.json'),
    zipCount: zipFiles.length,
    mergedCount,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await mergeStacNational({
    stacFolder: args.stacFolder,
    dataset: args.dataset || undefined,
    version: args.version,
    execute: args.execute,
    resume: args.resume,
    flat: args.flat,
    log: logger,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    logger.error('Fatal', err);
    process.exit(1);
  });
}
