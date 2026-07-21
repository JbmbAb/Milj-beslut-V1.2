import * as fs from 'node:fs/promises';
import path from 'node:path';

import {
  recommendReimportMode,
  resolveReimportScanRoots,
  resolveImportCacheRoot,
} from '../server/services/importPathService';

interface ScanCandidate {
  path: string;
  kind: 'manifest' | 'dataset-archive' | 'shapefile';
  recommendedAction: 'import-in-place' | 'copy-to-cache-then-import';
  suggestedCommand?: string;
}

const MAX_DEPTH = 4;
const MANIFEST_FILE_NAMES = new Set(['manifest.json', 'items.json']);
const ARCHIVE_EXTENSIONS = new Set(['.zip', '.gpkg', '.7z', '.rar', '.tar']);

function buildSuggestedCommand(fullPath: string, kind: ScanCandidate['kind']): string | undefined {
  const extension = path.extname(fullPath).toLowerCase();
  const normalizedPath = fullPath.toLowerCase();

  if (kind === 'manifest') {
    if (normalizedPath.includes('knowledge_base')) {
      const parts = fullPath.split(path.sep);
      const knowledgeBaseIndex = parts.findIndex((segment) => segment.toLowerCase() === 'knowledge_base');
      if (knowledgeBaseIndex !== -1) {
        const rootDir = parts.slice(0, knowledgeBaseIndex + 1).join(path.sep);
        return `npm run import:legal:corpus -- --root-dir "${rootDir}"`;
      }
    }

    return `Inspektera manifestet på plats och importera med domänspecifikt script från "${path.dirname(fullPath)}"`;
  }

  if (kind === 'shapefile') {
    return `Importera från plats med ogr2ogr eller befintligt geodata-script mot "${fullPath}"`;
  }

  if (extension === '.gpkg') {
    return `Importera GeoPackage direkt från plats med ogr2ogr mot "${fullPath}"`;
  }

  return `Packa upp till cache vid behov under "${resolveImportCacheRoot()}" och importera sedan från den extraherade mappen`;
}

function readNumberFlag(name: string): number | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const parsed = Number(process.argv[index + 1]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function scanDirectory(rootPath: string, maxCandidates: number): Promise<ScanCandidate[]> {
  const results: ScanCandidate[] = [];

  async function visit(currentPath: string, depth: number): Promise<void> {
    if (results.length >= maxCandidates || depth > MAX_DEPTH) {
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxCandidates) {
        return;
      }

      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();
      if (MANIFEST_FILE_NAMES.has(entry.name.toLowerCase())) {
        results.push({
          path: fullPath,
          kind: 'manifest',
          recommendedAction: recommendReimportMode(fullPath),
          suggestedCommand: buildSuggestedCommand(fullPath, 'manifest'),
        });
        continue;
      }

      if (extension === '.shp') {
        results.push({
          path: fullPath,
          kind: 'shapefile',
          recommendedAction: recommendReimportMode(fullPath),
          suggestedCommand: buildSuggestedCommand(fullPath, 'shapefile'),
        });
        continue;
      }

      if (ARCHIVE_EXTENSIONS.has(extension)) {
        results.push({
          path: fullPath,
          kind: 'dataset-archive',
          recommendedAction: recommendReimportMode(fullPath),
          suggestedCommand: buildSuggestedCommand(fullPath, 'dataset-archive'),
        });
      }
    }
  }

  await visit(rootPath, 0);
  return results;
}

async function main() {
  const maxCandidates = readNumberFlag('--limit') ?? 100;
  const scanRoots = resolveReimportScanRoots();
  const scanResults = await Promise.all(
    scanRoots.map(async (rootPath) => ({
      rootPath,
      exists: await pathExists(rootPath),
      candidates: (await pathExists(rootPath)) ? await scanDirectory(rootPath, maxCandidates) : [],
    })),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        importCacheRoot: resolveImportCacheRoot(),
        scanRoots,
        results: scanResults,
      },
      null,
      2,
    ),
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

main().catch((error) => {
  console.error('scan-import-sources failed:', error);
  process.exitCode = 1;
});
