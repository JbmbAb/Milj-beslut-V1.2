/**
 * Read local Master Archive state for Bibbi inventory-first scheduling.
 */
import * as fs from 'fs';
import * as path from 'path';

import { PATHS } from '../config/mimersBrunn';
import type { ArchiveManifest } from '../types/manifestSchema';
import { isArchiveManifestV2, readQaStatus } from '../types/manifestSchema';
import type { InventoryEntry, LocalState } from './types';

const VERSION_DIR = /^\d{4}-\d{2}-\d{2}/;

function listVersionDirs(datasetRoot: string): string[] {
  if (!fs.existsSync(datasetRoot)) return [];
  return fs
    .readdirSync(datasetRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && VERSION_DIR.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

function readManifest(manifestPath: string): ArchiveManifest | null {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ArchiveManifest;
  } catch {
    return null;
  }
}

function findZipPartialPct(rawDir: string, zipName?: string): { partial: boolean; pct: number } {
  if (!fs.existsSync(rawDir)) return { partial: false, pct: 0 };
  const zips = zipName
    ? [path.join(rawDir, zipName)]
    : fs.readdirSync(rawDir).filter((f) => f.toLowerCase().endsWith('.zip')).map((f) => path.join(rawDir, f));

  if (zips.length === 0) return { partial: false, pct: 0 };

  const zipPath = zips.find((z) => fs.existsSync(z));
  if (!zipPath) return { partial: false, pct: 0 };

  const stat = fs.statSync(zipPath);
  const assumedFullMb = 200;
  const sizeMb = stat.size / (1024 * 1024);
  if (sizeMb >= assumedFullMb * 0.9) return { partial: false, pct: 1 };
  return { partial: true, pct: Math.min(0.95, Math.max(0.1, sizeMb / assumedFullMb)) };
}

function inspectVersion(
  provider: string,
  datasetId: string,
  versionName: string,
  datasetRoot: string,
  zipFileName?: string,
): InventoryEntry | null {
  const versionPath = path.join(datasetRoot, versionName);
  const rawDir = path.join(versionPath, 'raw');
  const manifestPath = path.join(rawDir, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? readManifest(manifestPath) : null;

  if (manifest?.content_bundle_sha256) {
    const qa = readQaStatus(manifest);
    const localState: LocalState =
      qa === 'failed' ? 'stale' : isArchiveManifestV2(manifest) && !manifest.files_detail?.length ? 'stale' : 'complete';
    return {
      datasetId,
      provider,
      localState,
      localHash: manifest.content_bundle_sha256,
      partialPct: 0,
      versionPath,
      rawDir: fs.existsSync(rawDir) ? rawDir : null,
    };
  }

  const { partial, pct } = findZipPartialPct(rawDir, zipFileName);
  if (partial) {
    return {
      datasetId,
      provider,
      localState: 'partial',
      localHash: null,
      partialPct: pct,
      versionPath,
      rawDir,
    };
  }

  return null;
}

const STATE_RANK: Record<LocalState, number> = {
  complete: 4,
  stale: 3,
  partial: 2,
  none: 1,
};

function pickBestInventory(candidates: InventoryEntry[], empty: InventoryEntry): InventoryEntry {
  if (candidates.length === 0) return empty;
  return candidates.sort((a, b) => STATE_RANK[b.localState] - STATE_RANK[a.localState])[0]!;
}

export type InspectArchiveOptions = {
  provider: string;
  datasetId: string;
  zipFileName?: string;
};

/**
 * Inspect all version folders — prefer canonical complete over newer partial failures.
 */
export function inspectArchiveDataset(options: InspectArchiveOptions): InventoryEntry {
  const { provider, datasetId, zipFileName } = options;
  const datasetRoot = path.join(PATHS.DATA, provider, datasetId);
  const versions = listVersionDirs(datasetRoot);

  const empty: InventoryEntry = {
    datasetId,
    provider,
    localState: 'none',
    localHash: null,
    partialPct: 0,
    versionPath: null,
    rawDir: null,
  };

  if (versions.length === 0) return empty;

  const candidates: InventoryEntry[] = [];
  for (const versionName of versions) {
    const entry = inspectVersion(provider, datasetId, versionName, datasetRoot, zipFileName);
    if (entry) candidates.push(entry);
  }

  return pickBestInventory(candidates, empty);
}
