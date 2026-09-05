import type {
  VerifiedRegistryEntrySnapshot,
  VerifiedRegistrySnapshotProvider,
} from '@miljobeslut/mps-legal-corpus';

import { loadVerifiedSourceRegistry } from '../../../../packages/mps-data-governance/src/SourceRegistry';

/**
 * K2.1b — the concrete registry authority behind `CorpusImportGate`'s admission binding.
 *
 * Same role, same reason, and the same directory as `DownloadManifestSourceResolver`: a thin
 * adapter that lets `mps-legal-corpus` (storage-agnostic by design) consume `mps-data-governance`
 * without importing it. The domain package owns the admission DECISION
 * (`createRegistryAdmissionAuthority`); this owns only "load and cryptographically verify the
 * signed registry".
 *
 * Fail-closed contract, per `VerifiedRegistrySnapshotProvider`: this MUST throw rather than
 * return an empty or partial list when the registry cannot be loaded or verified. It therefore
 * does not catch anything — `loadVerifiedSourceRegistry` already fails the whole load atomically
 * if any single entry fails signature/lifecycle verification, and that throw is exactly the
 * signal the authority translates into REGISTRY_UNAVAILABLE. Swallowing it here would silently
 * downgrade "authority unavailable" into "artifact not found", which is a different, weaker
 * claim.
 *
 * Only APPROVED entries can be returned, because `loadVerifiedSourceRegistry` only ever
 * materializes APPROVED ones — a REJECTED/QUARANTINED entry fails verification for the entire
 * registry rather than being quietly skipped.
 */
export class SourceRegistryAdmissionAdapter implements VerifiedRegistrySnapshotProvider {
  constructor(private readonly registryPath?: string) {}

  async loadApprovedEntries(): Promise<readonly VerifiedRegistryEntrySnapshot[]> {
    const registry = await loadVerifiedSourceRegistry(
      this.registryPath ? { registryPath: this.registryPath } : {},
    );
    return registry.sources.map((source) => ({
      registryArtifactId: source.registryArtifactId,
      sourceContentHash: source.sourceContentHash,
    }));
  }
}
