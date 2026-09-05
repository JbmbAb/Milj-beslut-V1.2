import type { VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';
// Relative cross-package import, not a package-name import: @miljobeslut/mps-data-governance's
// own package.json declares "exports": { ".": "./src/ImportGate.ts" } — it does not expose
// SourceRegistry.ts on its public package-name surface, and this unit does not touch that
// package's exports map (out of scope for K2.1). This exact cross-package relative-import shape
// is already precedented in this repo: scripts/import/harvest/harvestScheduler.ts reaches
// packages/mps-data-governance/src/SourceRegistry.ts the same way, from outside that package.
import { loadVerifiedSourceRegistry } from '../../mps-data-governance/src/SourceRegistry';

/**
 * K2.1 — CORPUS-ADMISSION-REGISTRY-BINDING.
 *
 * Answers exactly one question, for a candidate NEW corpus admission:
 * `IS_USABLE_NOW_FOR_NEW_CORPUS_ADMISSION` — is `registryArtifactId` currently a real,
 * verified, APPROVED entry in the signed source registry, with the exact signed content hash
 * the caller claims?
 *
 * This is deliberately NOT `WAS_VALID_AT(T)`. It is consulted only from
 * `CorpusImportGate.checkOneImport`, which gates NEW writes — it is never called from any read,
 * retrieval, or replay path, so a later revocation can never retroactively invalidate a
 * historical attestation or a replay of past admission state. If a future unit ever wants
 * `WAS_VALID_AT(T)` semantics (e.g. for retroactive corpus-membership exclusion), that is a
 * different question requiring a different mechanism (historical registry snapshots or a
 * revocation ledger) — it must not be built by reinterpreting this check.
 *
 * Fail-closed, no fallback: every branch below returns an explicit `ok: false` with a specific
 * `reason`. There is no code path that treats "I could not determine this" as "allow it anyway".
 *
 * Authority is not expanded by this module: it only ever reads the existing, real
 * `loadVerifiedSourceRegistry()` — the same cryptographically-verified, signed-JSON-backed
 * source of truth every other governed consumer in this repo uses (e.g. the K1
 * `HarvestRuntimeCompositionRoot.ts` path). Nothing here treats Postgres, corpus tables,
 * materialization records, embeddings, or local quarantine files as authoritative.
 */

export type RegistryAdmissionDenialReason =
  | 'REGISTRY_UNAVAILABLE'
  | 'ARTIFACT_NOT_FOUND'
  | 'CONTENT_HASH_MISMATCH';

export interface RegistryAdmissionCheckResult {
  readonly ok: boolean;
  /** Present only when ok is false. One value per materially distinct authority failure. */
  readonly reason?: RegistryAdmissionDenialReason;
  readonly detail: string;
}

export interface RegistryAdmissionAuthority {
  /**
   * `registryArtifactId` names which SourceRegistryArtifact the caller claims this content
   * originates from; `registrySourceContentHash` is the claimed value of that artifact's own
   * signed content hash. Both are caller-supplied identifiers to look up — never trusted as
   * authority in themselves. Authority is only ever what this function independently resolves
   * from `loadVerifiedSourceRegistry()`.
   */
  checkAdmissible(
    registryArtifactId: string,
    registrySourceContentHash: string,
  ): Promise<RegistryAdmissionCheckResult>;
}

export interface RegistryAdmissionAuthorityOptions {
  /** Defaults to SOURCE_REGISTRY_ARTIFACT_PATH / the repo-resolved authority file, same as loadVerifiedSourceRegistry. */
  readonly registryPath?: string;
  /** Defaults to the environment-configured verification key(s), same as loadVerifiedSourceRegistry. */
  readonly signing?: VerificationKeyProvider;
}

export function createRegistryAdmissionAuthority(
  options: RegistryAdmissionAuthorityOptions = {},
): RegistryAdmissionAuthority {
  return {
    async checkAdmissible(
      registryArtifactId: string,
      registrySourceContentHash: string,
    ): Promise<RegistryAdmissionCheckResult> {
      if (
        typeof registryArtifactId !== 'string' ||
        registryArtifactId.length === 0 ||
        typeof registrySourceContentHash !== 'string' ||
        registrySourceContentHash.length === 0
      ) {
        return {
          ok: false,
          reason: 'ARTIFACT_NOT_FOUND',
          detail:
            'registry_artifact_id / registry_source_content_hash are missing or empty on the ' +
            'attestation predicate — nothing to resolve.',
        };
      }

      let sources: readonly { readonly registryArtifactId: string; readonly sourceContentHash: string }[];
      try {
        const registry = await loadVerifiedSourceRegistry({
          registryPath: options.registryPath,
          signing: options.signing,
        });
        sources = registry.sources;
      } catch (err) {
        // Fail closed: a registry that cannot be loaded/verified at all (missing file, missing
        // key configuration, or ANY single entry in it failing verification — the registry load
        // is atomic, see loadVerifiedSourceRegistry) is authority UNAVAILABLE, never "skip this
        // check" or "treat as approved".
        return {
          ok: false,
          reason: 'REGISTRY_UNAVAILABLE',
          detail: `verified source registry could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      const source = sources.find((s) => s.registryArtifactId === registryArtifactId);
      if (!source) {
        // Reached both by a fabricated artifact_id that never existed, and by an artifact_id
        // that WAS a real approved source but is no longer present in the active registry
        // (this repo's own convention for revocation/supersession is removal from
        // source-registry/national-registry.json, not an in-file REJECTED/QUARANTINED marker
        // left behind — see docs/architecture/KNOWLEDGE-INGESTION-REACHABILITY-AUDIT-2026-09-05.md).
        // Both cases mean the same thing for a NEW admission: this is not currently usable.
        return {
          ok: false,
          reason: 'ARTIFACT_NOT_FOUND',
          detail: `no currently APPROVED source registry entry has artifact_id '${registryArtifactId}'.`,
        };
      }

      if (source.sourceContentHash !== registrySourceContentHash) {
        return {
          ok: false,
          reason: 'CONTENT_HASH_MISMATCH',
          detail:
            `source registry entry '${registryArtifactId}' is currently approved, but its ` +
            'signed content hash does not match the value claimed by this attestation.',
        };
      }

      return {
        ok: true,
        detail: `resolved to currently-APPROVED source registry entry '${registryArtifactId}'.`,
      };
    },
  };
}
