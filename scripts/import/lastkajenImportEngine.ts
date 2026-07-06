/**
 * @deprecated Sunset 2026-09-01 — use import-librarian-manifest.ts only.
 * See docs/architecture/import-librarian-only-policy.md
 */
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { PrismaClient } from '@prisma/client';
import type { LastkajenImportJob } from '../../server/datasources/lastkajenImportManifest';

export const OGR2OGR_PATH = 'C:\\Program Files\\GDAL\\ogr2ogr.exe';
export const OGRINFO_PATH = 'C:\\Program Files\\GDAL\\ogrinfo.exe';

const MAX_OGR_BUFFER = 50 * 1024 * 1024;

export interface ResolvedGpkgSource {
  sourcePath: string;
  cleanup: () => void;
}

export function vsizipPath(absPath: string, innerPath?: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  const base = `/vsizip/${normalized}`;
  return innerPath ? `${base}/${innerPath.replace(/\\/g, '/')}` : base;
}

export function buildPgConn(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return `PG:dbname='${url.pathname.slice(1)}' host='${url.hostname}' user='${url.username}' password='${url.password}' port='${url.port || '5432'}'`;
}

export function sanitizePgIdentifier(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 55);
}

export function hasNonAsciiPath(filePath: string): boolean {
  return /[^\u0020-\u007E]/.test(filePath);
}

export function hasCombiningMarks(filePath: string): boolean {
  return /[\u0300-\u036f]/.test(filePath.normalize('NFD'));
}

export function canOpenOgrSource(sourcePath: string): boolean {
  try {
    execSync(`"${OGRINFO_PATH}" -ro -q "${sourcePath}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: MAX_OGR_BUFFER,
    });
    return true;
  } catch {
    return false;
  }
}

export function findFilesRecursive(dir: string, extension: string): string[] {
  const normalizedExt = extension.toLowerCase();
  const matches: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      matches.push(...findFilesRecursive(fullPath, extension));
    } else if (entry.name.toLowerCase().endsWith(normalizedExt)) {
      matches.push(fullPath);
    }
  }
  return matches;
}

function gdalExtractRoot(): string {
  const root = path.join(process.cwd(), 'storage', 'ingest', '.gdal-extract');
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function copyZipToAsciiTemp(zipPath: string): { zipPath: string; cleanup: () => void } {
  const tempDir = path.join(gdalExtractRoot(), 'zip-cache');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempZip = path.join(tempDir, `archive-${process.pid}-${Date.now()}.zip`);
  const isCloudDrive = zipPath.startsWith('H:') || zipPath.toLowerCase().includes('delade enheter');
  if (isCloudDrive) {
    const content = fs.readFileSync(zipPath);
    fs.writeFileSync(tempZip, content);
  } else {
    try {
      fs.copyFileSync(zipPath, tempZip);
    } catch (err) {
      // Fallback: copy via reading/writing buffer to handle Google Drive FS virtual files
      const content = fs.readFileSync(zipPath);
      fs.writeFileSync(tempZip, content);
    }
  }
  return {
    zipPath: tempZip,
    cleanup: () => {
      try {
        fs.unlinkSync(tempZip);
      } catch {
        // ignore stale temp zip
      }
    },
  };
}

function tarExtractZip(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true });
  const needsAsciiCopy = hasNonAsciiPath(zipPath) || hasCombiningMarks(zipPath);
  const prepared = needsAsciiCopy ? copyZipToAsciiTemp(zipPath) : { zipPath, cleanup: () => {} };
  try {
    execSync(`tar -xf "${prepared.zipPath}" -C "${destDir}"`, {
      stdio: 'pipe',
      maxBuffer: MAX_OGR_BUFFER,
    });
  } finally {
    prepared.cleanup();
  }
}

/**
 * Resolve a GDAL-readable GeoPackage path from a zip on disk.
 * Handles Swedish characters in zip paths and inner entry names (Windows/GDAL CP437 issues).
 */
export function resolveGpkgSource(
  zipPath: string,
  innerHint?: string | ((zipBase: string) => string),
  options?: { requireExtractedGpkg?: boolean },
): ResolvedGpkgSource {
  const isCloudDrive = zipPath.startsWith('H:') || zipPath.toLowerCase().includes('delade enheter');
  if (!options?.requireExtractedGpkg && !isCloudDrive) {
    const zipOnly = vsizipPath(zipPath);
    if (canOpenOgrSource(zipOnly)) {
      return { sourcePath: zipOnly, cleanup: () => {} };
    }

    if (innerHint) {
      const inner = typeof innerHint === 'function' ? innerHint(path.basename(zipPath)) : innerHint;
      const hinted = vsizipPath(zipPath, inner);
      if (canOpenOgrSource(hinted)) {
        return { sourcePath: hinted, cleanup: () => {} };
      }
    }
  } else if (innerHint && !isCloudDrive) {
    const inner = typeof innerHint === 'function' ? innerHint(path.basename(zipPath)) : innerHint;
    const hinted = vsizipPath(zipPath, inner);
    if (canOpenOgrSource(hinted)) {
      return { sourcePath: hinted, cleanup: () => {} };
    }
  }

  const extractDir = fs.mkdtempSync(path.join(gdalExtractRoot(), 'extract-'));
  const cleanupExtract = () => {
    try {
      fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // ignore stale extract dir
    }
  };

  try {
    tarExtractZip(zipPath, extractDir);
    const gpkgFiles = findFilesRecursive(extractDir, '.gpkg').filter(
      (filePath) => !filePath.toLowerCase().includes('layer_styles'),
    );
    if (gpkgFiles.length === 0) {
      throw new Error(`Ingen .gpkg hittades i ${path.basename(zipPath)}`);
    }
    gpkgFiles.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
    const sourcePath = gpkgFiles[0].replace(/\\/g, '/');
    if (!canOpenOgrSource(sourcePath)) {
      throw new Error(`Kan inte öppna extraherad gpkg från ${path.basename(zipPath)}`);
    }
    return { sourcePath, cleanup: cleanupExtract };
  } catch (error) {
    cleanupExtract();
    throw error;
  }
}

export function listOgrLayerNames(sourcePath: string): string[] {
  const output = execSync(`"${OGRINFO_PATH}" -ro -q "${sourcePath}"`, {
    encoding: 'utf8',
    maxBuffer: MAX_OGR_BUFFER,
  });
  const layers: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    const numbered = trimmed.match(/^\d+:\s*(.+?)(?:\s+\(|$)/);
    const labeled = trimmed.match(/^Layer:\s*(.+?)(?:\s+\(|$)/);
    const name = (numbered?.[1] ?? labeled?.[1])?.trim();
    if (name && !/^gpkg_|^sqlite_|^layer_styles$/i.test(name)) {
      layers.push(name);
    }
  }
  return layers;
}

export function listZipEntries(zipPath: string): string[] {
  try {
    const output = execSync(`tar -tf "${zipPath}"`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
    return output.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** @deprecated Prefer resolveGpkgSource – kept for tests/backward compatibility. */
export function findInnerGpkgPath(zipPath: string, hint?: string | ((zipBase: string) => string)): string | undefined {
  try {
    return resolveGpkgSource(zipPath, hint).sourcePath;
  } catch {
    const base = path.basename(zipPath);
    if (typeof hint === 'function') {
      return hint(base);
    }
    if (hint) {
      return hint;
    }
    const entries = listZipEntries(zipPath);
    const gpkg = entries.find((e) => e.toLowerCase().endsWith('.gpkg') && !e.includes('layer_styles'));
    if (gpkg) {
      return gpkg;
    }
    return `${base.replace(/\.zip$/i, '')}.gpkg`;
  }
}

export function resolveZipFile(packageDir: string, job: LastkajenImportJob): string {
  if (!fs.existsSync(packageDir)) {
    throw new Error(`Paketkatalog saknas: ${packageDir}`);
  }
  const files = fs.readdirSync(packageDir).filter((f) => f.toLowerCase().endsWith('.zip'));
  if (job.zipFile) {
    const exact = files.find((f) => f === job.zipFile);
    if (!exact) {
      throw new Error(`Zip saknas: ${job.zipFile} i ${packageDir}`);
    }
    return path.join(packageDir, exact);
  }
  if (job.zipGlob) {
    const match = files.find((f) => job.zipGlob!.test(f));
    if (!match) {
      throw new Error(`Ingen zip matchar ${job.zipGlob} i ${packageDir}`);
    }
    return path.join(packageDir, match);
  }
  throw new Error(`Job ${job.key} saknar zipFile/zipGlob`);
}

export function discoverDataLayer(sourcePath: string, preferred?: string): string {
  const layers = listOgrLayerNames(sourcePath);
  if (preferred && layers.includes(preferred)) {
    return preferred;
  }
  if (layers.length === 0) {
    throw new Error(`Inga datalager i ${sourcePath}`);
  }
  return layers[0];
}

export function findHotspotLayer(sourcePath: string): string {
  const layers = listOgrLayerNames(sourcePath);
  const hotspot = layers.find((name) => name.toLowerCase().includes('hotspot'));
  if (!hotspot) {
    throw new Error(`Ingen hotspot-layer i ${sourcePath}. Hittade: ${layers.join(', ')}`);
  }
  return hotspot;
}

export function parseViltArt(zipFileName: string): string {
  const match = /^Viltolyckskartor_(.+)_(\d+)\.zip$/i.exec(zipFileName);
  if (!match?.[1]) {
    throw new Error(`Kan inte tolka djurart från ${zipFileName}`);
  }
  return match[1];
}

export function parseViltPeriod(zipFileName: string): string | undefined {
  const match = /^Viltolyckskartor_(.+)_(\d+)\.zip$/i.exec(zipFileName);
  return match?.[2];
}

export function viltInnerGpkgPath(zipBaseName: string): string {
  const folder = zipBaseName.replace(/\.zip$/i, '');
  return `${folder}/${folder}.gpkg`;
}

export function runOgr(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(OGR2OGR_PATH, args, { stdio: 'inherit', shell: false });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ogr2ogr failed with code ${code}`));
    });
  });
}

async function ensureSchema(prisma: PrismaClient, tableRef: string): Promise<void> {
  const schema = tableRef.split('.')[0];
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${schema};`);
}

async function countRows(prisma: PrismaClient, tableRef: string): Promise<bigint> {
  const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*)::bigint AS n FROM ${tableRef}`);
  return rows[0]?.n ?? 0n;
}

export async function importLayerToPostgis(
  prisma: PrismaClient,
  pgConn: string,
  tableRef: string,
  sourcePath: string,
  layerName: string,
  mode: 'overwrite' | 'append',
  extraSql?: string,
): Promise<void> {
  await ensureSchema(prisma, tableRef);
  const schema = tableRef.split('.')[0];

  const args = [
    '-f',
    'PostgreSQL',
    pgConn,
    sourcePath,
    layerName,
    '-nln',
    tableRef,
    mode === 'overwrite' ? '-overwrite' : '-append',
    ...(extraSql
      ? ['-dialect', 'SQLite', '-sql', extraSql]
      : []),
    '-lco',
    'GEOMETRY_NAME=geom',
    ...(mode === 'overwrite' ? ['-lco', 'SPATIAL_INDEX=GIST'] : []),
    '-lco',
    `SCHEMA=${schema}`,
    '-nlt',
    'PROMOTE_TO_MULTI',
    '-t_srs',
    'EPSG:3006',
    '--config',
    'PG_USE_COPY',
    'YES',
  ];

  await runOgr(args);
}

export async function runLastkajenImportJob(
  prisma: PrismaClient,
  pgConn: string,
  ingestRoot: string,
  job: LastkajenImportJob,
): Promise<{ tables: Array<{ table: string; rows: bigint }> }> {
  const packageDir = path.join(ingestRoot, String(job.packageId));
  const results: Array<{ table: string; rows: bigint }> = [];

  console.log(`\n→ ${job.key} (${job.label})`);

  switch (job.mode) {
    case 'single_gpkg_zip': {
      const zipPath = resolveZipFile(packageDir, job);
      const resolved = resolveGpkgSource(zipPath, job.innerGpkgPath);
      try {
        const layer = discoverDataLayer(resolved.sourcePath, job.layerName);
        console.log(`   ${path.basename(zipPath)} / ${layer}`);
        await importLayerToPostgis(prisma, pgConn, job.table, resolved.sourcePath, layer, 'overwrite');
        results.push({ table: job.table, rows: await countRows(prisma, job.table) });
      } finally {
        resolved.cleanup();
      }
      break;
    }
    case 'multi_layer_gpkg': {
      const zipPath = resolveZipFile(packageDir, job);
      const resolved = resolveGpkgSource(zipPath, job.innerGpkgPath);
      try {
        const layers = job.importAllLayers
          ? listOgrLayerNames(resolved.sourcePath)
          : [discoverDataLayer(resolved.sourcePath, job.layerName)];
        let first = true;
        for (const layer of layers) {
          const suffix = sanitizePgIdentifier(layer);
          const tableRef = job.importAllLayers ? `${job.table}_${suffix}` : job.table;
          console.log(`   layer ${layer} → ${tableRef}`);
          await importLayerToPostgis(prisma, pgConn, tableRef, resolved.sourcePath, layer, first ? 'overwrite' : 'append');
          results.push({ table: tableRef, rows: await countRows(prisma, tableRef) });
          first = false;
        }
      } finally {
        resolved.cleanup();
      }
      break;
    }
    case 'merge_gpkg_zips': {
      const filter = job.zipFilter ?? /\.zip$/i;
      const zipFiles = fs
        .readdirSync(packageDir)
        .filter((name) => filter.test(name) && name.toLowerCase().endsWith('.zip') && !/kvitto/i.test(name))
        .sort();
      if (zipFiles.length === 0) {
        throw new Error(`Inga zip-filer för ${job.key} i ${packageDir}`);
      }
      let first = true;
      for (const zipFileName of zipFiles) {
        const zipPath = path.join(packageDir, zipFileName);
        const resolved = resolveGpkgSource(zipPath, job.innerGpkgPath);
        try {
          const layer = discoverDataLayer(resolved.sourcePath, job.layerName);
          const safeName = zipFileName.replace(/'/g, "''");
          const sql = `SELECT *, '${safeName}' AS lk_source_file FROM "${layer.replace(/"/g, '""')}"`;
          console.log(`   ${zipFileName}`);
          await importLayerToPostgis(prisma, pgConn, job.table, resolved.sourcePath, layer, first ? 'overwrite' : 'append', sql);
          first = false;
        } finally {
          resolved.cleanup();
        }
      }
      results.push({ table: job.table, rows: await countRows(prisma, job.table) });
      break;
    }
    case 'per_gpkg_zip': {
      const filter = job.zipFilter ?? /_gpkg\.zip$/i;
      const zipFiles = fs
        .readdirSync(packageDir)
        .filter((name) => filter.test(name) && !/kvitto/i.test(name))
        .sort();
      if (zipFiles.length === 0) {
        throw new Error(`Inga zip-filer för ${job.key} i ${packageDir}`);
      }
      for (const zipFileName of zipFiles) {
        const suffix = sanitizePgIdentifier(
          job.tableSuffixFromZip ? job.tableSuffixFromZip(zipFileName) : zipFileName.replace(/\.zip$/i, ''),
        );
        const tableRef = `${job.table}_${suffix}`;
        const zipPath = path.join(packageDir, zipFileName);
        const resolved = resolveGpkgSource(zipPath, job.innerGpkgPath);
        try {
          const layer = discoverDataLayer(resolved.sourcePath, job.layerName);
          console.log(`   ${zipFileName} → ${tableRef}`);
          await importLayerToPostgis(prisma, pgConn, tableRef, resolved.sourcePath, layer, 'overwrite');
          results.push({ table: tableRef, rows: await countRows(prisma, tableRef) });
        } finally {
          resolved.cleanup();
        }
      }
      break;
    }
    case 'vilt_hotspots': {
      const pattern = job.viltPattern ?? /^Viltolyckskartor_.*_\d+\.zip$/i;
      const zipFiles = fs.readdirSync(packageDir).filter((name) => pattern.test(name)).sort();
      if (zipFiles.length === 0) {
        throw new Error(`Inga vilt-zip i ${packageDir}`);
      }
      let first = true;
      let imported = 0;
      for (const zipFileName of zipFiles) {
        const art = parseViltArt(zipFileName);
        const period = parseViltPeriod(zipFileName);
        const zipPath = path.join(packageDir, zipFileName);
        let resolved: ResolvedGpkgSource;
        try {
          resolved = resolveGpkgSource(zipPath, viltInnerGpkgPath, { requireExtractedGpkg: true });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('Ingen .gpkg')) {
            console.warn(`   ⚠ Hoppar ${zipFileName}: legacy-format utan GeoPackage`);
            continue;
          }
          throw error;
        }
        try {
          const layerName = findHotspotLayer(resolved.sourcePath);
          const periodSql = period ? `, '${period.replace(/'/g, "''")}' AS vilt_period` : '';
          const sql = `SELECT *, '${art.replace(/'/g, "''")}' AS djurart${periodSql} FROM "${layerName.replace(/"/g, '""')}"`;
          console.log(`   ${art}${period ? ` (${period})` : ''}`);
          await importLayerToPostgis(prisma, pgConn, job.table, resolved.sourcePath, layerName, first ? 'overwrite' : 'append', sql);
          first = false;
          imported += 1;
        } finally {
          resolved.cleanup();
        }
      }
      if (imported === 0) {
        throw new Error(
          `Inga GeoPackage-viltark importerades för ${job.key} (paket ${job.packageId} använder legacy shapefile/raster, inte hotspot-gpkg)`,
        );
      }
      results.push({ table: job.table, rows: await countRows(prisma, job.table) });
      break;
    }
    case 'filegdb_in_zip': {
      const zipPath = resolveZipFile(packageDir, job);
      const base = path.basename(zipPath);
      const gdbRel =
        typeof job.gdbPathInZip === 'function' ? job.gdbPathInZip(base) : job.gdbPathInZip;
      if (!gdbRel) {
        throw new Error(`gdbPathInZip saknas för ${job.key}`);
      }
      const source = vsizipPath(zipPath, gdbRel);
      const layers = listOgrLayerNames(source);
      if (layers.length === 0) {
        throw new Error(`Inga lager i FileGDB ${source}`);
      }
      let first = true;
      for (const layer of layers) {
        const suffix = layers.length === 1 ? '' : `_${sanitizePgIdentifier(layer)}`;
        const tableRef = `${job.table}${suffix}`;
        console.log(`   gdb layer ${layer} → ${tableRef}`);
        await importLayerToPostgis(prisma, pgConn, tableRef, source, layer, first ? 'overwrite' : 'append');
        results.push({ table: tableRef, rows: await countRows(prisma, tableRef) });
        first = false;
      }
      break;
    }
    default: {
      const _exhaustive: never = job.mode;
      throw new Error(`Okänt importläge: ${String(_exhaustive)}`);
    }
  }

  for (const r of results) {
    console.log(`   ✓ ${r.table}: ${r.rows} rader`);
  }

  return { tables: results };
}

export function listDownloadedPackageIds(ingestRoot: string): number[] {
  if (!fs.existsSync(ingestRoot)) {
    return [];
  }
  return fs
    .readdirSync(ingestRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d+$/.test(d.name))
    .map((d) => Number(d.name))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
}

export function jobsForDownloadedPackages(
  jobs: LastkajenImportJob[],
  downloadedIds: number[],
): LastkajenImportJob[] {
  const idSet = new Set(downloadedIds);
  return jobs.filter((job) => idSet.has(job.packageId));
}
