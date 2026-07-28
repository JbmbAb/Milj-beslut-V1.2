/**
 * Inventory-first harvest scheduler (AlphaEvolve port → Bibbi orchestrator).
 *
 * Evolved from benchmarks/alpha_evolve_bibbi_harvest (exp-flying-manul).
 */
import type { CatalogEntry, HarvestAction, HarvestPlan, HarvestPlanItem, InventoryEntry } from './types';

function resolveAction(entry: InventoryEntry, remoteHash: string | null | undefined): HarvestAction {
  if (entry.localState === 'complete') {
    if (remoteHash != null && entry.localHash != null && entry.localHash !== remoteHash) {
      return 'REHARVEST';
    }
    if (remoteHash == null || entry.localHash === remoteHash) {
      return 'SKIP';
    }
    return 'REHARVEST';
  }
  if (entry.localState === 'partial') return 'RESUME';
  if (entry.localState === 'stale') return 'REHARVEST';
  if (entry.localState === 'none') return 'DOWNLOAD';
  return 'DOWNLOAD';
}

function actionReason(entry: InventoryEntry, action: HarvestAction, remoteHash?: string | null): string {
  switch (action) {
    case 'SKIP':
      return remoteHash
        ? `complete, hash match (${entry.localHash?.slice(0, 12)}…)`
        : 'complete, canonical manifest in archive';
    case 'RESUME':
      return `partial download (~${Math.round(entry.partialPct * 100)}% on disk)`;
    case 'REHARVEST':
      if (entry.localState === 'stale') return 'stale archive copy';
      return 'complete but hash mismatch vs remote';
    case 'DOWNLOAD':
      return entry.localState === 'none' ? 'missing in archive' : 'fallback download';
    default:
      return action;
  }
}

/** Sort tier ascending (1 first), then largest datasets first within tier. */
export function sortCatalogForScheduling(catalog: CatalogEntry[]): CatalogEntry[] {
  return [...catalog].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.sizeMb - a.sizeMb;
  });
}

/**
 * Build an ordered harvest plan for every catalog dataset.
 * Pure function — safe to unit test without filesystem access.
 */
export function planHarvestSchedule(
  inventory: InventoryEntry[],
  catalog: CatalogEntry[],
): HarvestPlan {
  const invById = new Map(inventory.map((e) => [`${e.provider}:${e.datasetId}`, e]));
  const sorted = sortCatalogForScheduling(catalog);
  const items: HarvestPlanItem[] = [];

  for (let rank = 0; rank < sorted.length; rank += 1) {
    const spec = sorted[rank]!;
    const key = `${spec.provider}:${spec.datasetId}`;
    const entry = invById.get(key) ?? {
      datasetId: spec.datasetId,
      provider: spec.provider,
      localState: 'none' as const,
      localHash: null,
      partialPct: 0,
      versionPath: null,
      rawDir: null,
    };

    const action = resolveAction(entry, spec.remoteHash ?? null);
    items.push({
      datasetId: spec.datasetId,
      provider: spec.provider,
      action,
      priorityRank: rank,
      tier: spec.tier,
      versionPath: entry.versionPath,
      rawDir: entry.rawDir,
      reason: actionReason(entry, action, spec.remoteHash),
    });
  }

  const summary = { skip: 0, download: 0, resume: 0, reharvest: 0 };
  for (const item of items) {
    const k = item.action.toLowerCase() as keyof typeof summary;
    if (k in summary) summary[k] += 1;
  }

  return { items, summary };
}
