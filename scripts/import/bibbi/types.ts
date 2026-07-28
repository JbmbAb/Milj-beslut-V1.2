/** Bibbi (Mimer Bibliotekarie) harvest orchestrator — shared types. */

export type HarvestAction = 'SKIP' | 'DOWNLOAD' | 'RESUME' | 'REHARVEST';

export type LocalState = 'none' | 'partial' | 'complete' | 'stale';

export type InventoryEntry = {
  datasetId: string;
  provider: string;
  localState: LocalState;
  /** content_bundle_sha256 from manifest when known */
  localHash: string | null;
  /** 0–1 fraction already on disk for partial ZIP harvests */
  partialPct: number;
  /** Latest version folder under Master Archive, if any */
  versionPath: string | null;
  rawDir: string | null;
};

export type CatalogEntry = {
  datasetId: string;
  provider: string;
  registryDataset: string;
  /** 1 = highest priority */
  tier: number;
  sizeMb: number;
  /** Expected remote bundle hash; when set, compared to inventory.localHash */
  remoteHash?: string | null;
  failureRate?: number;
};

export type HarvestPlanItem = {
  datasetId: string;
  provider: string;
  action: HarvestAction;
  priorityRank: number;
  tier: number;
  versionPath: string | null;
  rawDir: string | null;
  reason: string;
};

export type HarvestPlan = {
  items: HarvestPlanItem[];
  summary: {
    skip: number;
    download: number;
    resume: number;
    reharvest: number;
  };
};
