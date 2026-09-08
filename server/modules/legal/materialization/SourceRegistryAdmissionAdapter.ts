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
/** The active, verified registry identity for one source. */
export interface ActiveRegistryBinding {
  readonly registryArtifactId: string;
  readonly registrySourceContentHash: string;
}

/**
 * K2.1b(2) — resolve a caller's registry binding from the ACTIVE verified registry, keyed by the
 * stable `source_id`, instead of freezing a copied `artifact_id` constant.
 *
 * Why this exists: `artifact_id` is re-issued on re-attestation (the active registry currently
 * carries `-002` / `-004` where callers had hardcoded `-001` / `-003`), while
 * `source_content_hash` stayed byte-identical across that same re-attestation. A frozen
 * artifact-id constant therefore goes stale the moment the registry is re-attested and every
 * admission under it starts failing ARTIFACT_NOT_FOUND — which is exactly what happened. The
 * stable anchor is (source_id, source_content_hash); the artifact id is the volatile label.
 *
 * `expectedSourceContentHash` is NOT cosmetic: it preserves the caller's original content
 * binding across this indirection. If a re-attestation ever changed a source's substantive
 * scope/policy (which is what `source_content_hash` covers), this throws instead of silently
 * re-pointing the caller at a materially different authority. Re-labelling is tolerated;
 * re-scoping is not.
 *
 * This does NOT implement successor-chain semantics: it answers only "what is the active
 * identity for this source right now", never "what superseded what". Fail-closed throughout —
 * an unloadable registry or an unknown source_id throws rather than returning a guess.
 */
export async function resolveActiveRegistryBinding(args: {
  readonly sourceId: string;
  readonly expectedSourceContentHash?: string;
  readonly registryPath?: string;
}): Promise<ActiveRegistryBinding> {
  const registry = await loadVerifiedSourceRegistry(
    args.registryPath ? { registryPath: args.registryPath } : {},
  );
  const source = registry.getSource(args.sourceId);
  if (!source) {
    throw new Error(
      `REJECT_ACTIVE_REGISTRY_BINDING: source_id '${args.sourceId}' is not a currently APPROVED ` +
        `entry in the verified registry at '${registry.registryPath}'.`,
    );
  }
  if (
    args.expectedSourceContentHash !== undefined &&
    args.expectedSourceContentHash !== source.sourceContentHash
  ) {
    throw new Error(
      `REJECT_ACTIVE_REGISTRY_BINDING: source_id '${args.sourceId}' resolves to artifact ` +
        `'${source.registryArtifactId}', but its signed source_content_hash ` +
        `'${source.sourceContentHash}' does not match the expected '${args.expectedSourceContentHash}'. ` +
        'A re-attestation may re-label an artifact id, but a changed content hash means the ' +
        "source's substantive scope changed — that requires review, not automatic re-binding.",
    );
  }
  return {
    registryArtifactId: source.registryArtifactId,
    registrySourceContentHash: source.sourceContentHash,
  };
}

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
