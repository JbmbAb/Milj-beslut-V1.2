/**
 * Build Bibbi catalog entries from SGU harvest registry + archive size hints.
 */
import * as fs from 'fs';
import * as path from 'path';

import { SGU_HARVEST_SOURCES } from '../config/sguHarvestSources';
import { inspectArchiveDataset } from './inventoryFromArchive';
import type { CatalogEntry, InventoryEntry } from './types';

/** Tier-1 produktkritiska (matches run-national-reharvest SGU_ORDER head). */
const SGU_TIER1 = new Set([
  'Grundvatten',
  'Brunnar',
  'Jordskred',
  'Fastmark',
  'AktsamhetEfterarbetad',
  'Genomslapplighet',
]);

const SGU_TIER2 = new Set([
  'Jorddjupsmodell',
  'StranderosionKust',
  'Jordarter750kBlockighet',
  'Jordarter750kLandform',
  'MiljogifterAnalysresultat',
  'MiljogifterProvplatser',
  'HypeOmraden',
  'HypeKlimatindikatorerHistorisk',
  'HypeKlimatindikatorerRcp',
  'FlygGammaOversiktlig',
]);

export function sguTier(sourceId: string): number {
  if (SGU_TIER1.has(sourceId)) return 1;
  if (SGU_TIER2.has(sourceId)) return 2;
  return 3;
}

export function buildSguCatalog(onlyIds?: string[]): CatalogEntry[] {
  const sources = onlyIds?.length
    ? SGU_HARVEST_SOURCES.filter((s) => onlyIds.includes(s.id))
    : SGU_HARVEST_SOURCES;

  return sources.map((source) => {
    const inv = inspectArchiveDataset({
      provider: 'SGU',
      datasetId: source.id,
      zipFileName: source.zip?.zipFileName,
    });

    let sizeMb = 100;
    const manifestPath = inv.rawDir ? path.join(inv.rawDir, 'manifest.json') : null;
    if (manifestPath && fs.existsSync(manifestPath)) {
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { total_bytes?: number };
        sizeMb = Math.max(1, (m.total_bytes ?? 0) / (1024 * 1024));
      } catch {
        /* default */
      }
    }

    return {
      datasetId: source.id,
      provider: 'SGU',
      registryDataset: source.registryDataset,
      tier: sguTier(source.id),
      sizeMb,
      remoteHash: undefined,
    };
  });
}

export function buildSguInventory(onlyIds?: string[]): InventoryEntry[] {
  const sources = onlyIds?.length
    ? SGU_HARVEST_SOURCES.filter((s) => onlyIds.includes(s.id))
    : SGU_HARVEST_SOURCES;

  return sources.map((source) =>
    inspectArchiveDataset({
      provider: 'SGU',
      datasetId: source.id,
      zipFileName: source.zip?.zipFileName,
    }),
  );
}
