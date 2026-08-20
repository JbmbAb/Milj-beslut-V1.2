import type { ContentReference } from '@miljobeslut/mps-core';
import type { SourceManifestResolver } from '@miljobeslut/mps-legal-corpus';
import type { DownloadManifestStore } from '../../../../packages/mps-data-governance/src/DownloadManifestStore';

/**
 * LEGAL-CORPUS-MATERIALIZATION-V1 (part B) — the real join point between P2 acquisition
 * (proven live in P2-HARVEST-LIVE-01) and legal corpus materialization.
 *
 * A thin adapter, not a second manifest model: `DownloadManifestStore.resolve` already has the
 * exact shape `SourceManifestResolver` needs (`ContentReference -> T | null`). This class exists
 * only so the composition root can hand `GovernedLegalCorpusMaterializer` the port it declares,
 * without `mps-legal-corpus` (storage-agnostic by design) importing `mps-data-governance`
 * directly.
 */
export class DownloadManifestSourceResolver implements SourceManifestResolver {
  constructor(private readonly store: DownloadManifestStore) {}

  resolve(reference: ContentReference): Promise<unknown | null> {
    return this.store.resolve(reference);
  }
}
