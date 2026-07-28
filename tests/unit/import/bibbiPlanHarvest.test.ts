import { describe, expect, it } from 'vitest';

import { planHarvestSchedule, sortCatalogForScheduling } from '../../../scripts/import/bibbi/planHarvestSchedule';
import type { CatalogEntry, InventoryEntry } from '../../../scripts/import/bibbi/types';

const inv = (overrides: Partial<InventoryEntry> & Pick<InventoryEntry, 'datasetId'>): InventoryEntry => ({
  provider: 'SGU',
  localState: 'none',
  localHash: null,
  partialPct: 0,
  versionPath: null,
  rawDir: null,
  ...overrides,
});

const cat = (overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'datasetId'>): CatalogEntry => ({
  provider: 'SGU',
  registryDataset: overrides.datasetId,
  tier: 2,
  sizeMb: 100,
  ...overrides,
});

describe('planHarvestSchedule (Bibbi / AlphaEvolve port)', () => {
  it('SKIP complete datasets with matching hash', () => {
    const inventory = [
      inv({
        datasetId: 'Brunnar',
        localState: 'complete',
        localHash: 'sha256:abc',
      }),
    ];
    const catalog = [cat({ datasetId: 'Brunnar', remoteHash: 'sha256:abc' })];
    const plan = planHarvestSchedule(inventory, catalog);
    expect(plan.items[0]?.action).toBe('SKIP');
  });

  it('RESUME partial and REHARVEST stale', () => {
    const inventory = [
      inv({ datasetId: 'A', localState: 'partial', partialPct: 0.4, rawDir: '/raw/a' }),
      inv({ datasetId: 'B', localState: 'stale', localHash: 'sha256:old' }),
      inv({ datasetId: 'C', localState: 'none' }),
    ];
    const catalog = [
      cat({ datasetId: 'A', tier: 1 }),
      cat({ datasetId: 'B', tier: 1 }),
      cat({ datasetId: 'C', tier: 3 }),
    ];
    const plan = planHarvestSchedule(inventory, catalog);
    const byId = Object.fromEntries(plan.items.map((i) => [i.datasetId, i.action]));
    expect(byId.A).toBe('RESUME');
    expect(byId.B).toBe('REHARVEST');
    expect(byId.C).toBe('DOWNLOAD');
  });

  it('sorts tier-1 before tier-3, larger size first within tier', () => {
    const catalog = [
      cat({ datasetId: 'low', tier: 3, sizeMb: 500 }),
      cat({ datasetId: 'big', tier: 1, sizeMb: 300 }),
      cat({ datasetId: 'small', tier: 1, sizeMb: 50 }),
    ];
    const sorted = sortCatalogForScheduling(catalog);
    expect(sorted.map((c) => c.datasetId)).toEqual(['big', 'small', 'low']);
  });

  it('REHARVEST when complete hash differs from remote', () => {
    const inventory = [inv({ datasetId: 'X', localState: 'complete', localHash: 'sha256:local' })];
    const catalog = [cat({ datasetId: 'X', remoteHash: 'sha256:remote' })];
    const plan = planHarvestSchedule(inventory, catalog);
    expect(plan.items[0]?.action).toBe('REHARVEST');
  });

  it('SKIP complete when no remote hash is configured (inventory-first default)', () => {
    const inventory = [inv({ datasetId: 'Y', localState: 'complete', localHash: 'sha256:local' })];
    const catalog = [cat({ datasetId: 'Y' })];
    const plan = planHarvestSchedule(inventory, catalog);
    expect(plan.items[0]?.action).toBe('SKIP');
  });
});
