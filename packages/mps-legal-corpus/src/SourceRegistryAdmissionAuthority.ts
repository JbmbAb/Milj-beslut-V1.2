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
 * ARCHITECTURE (K2.1b, after independent verification): this module holds the DECISION logic
 * only. It does not know how to load or cryptographically verify a registry, and deliberately
 * imports nothing from `mps-data-governance` — `mps-legal-corpus` is storage-agnostic by design,
 * the same boundary `DownloadManifestSourceResolver` exists to preserve. The concrete
 * `loadVerifiedSourceRegistry`-backed provider lives in the server composition layer and is
 * injected through `VerifiedRegistrySnapshotProvider` below. Authority is therefore still the
 * signed registry and nothing else: this module cannot invent an approved entry, and a provider
 * that fails to produce a verified snapshot causes denial, never a bypass.
 */

export type RegistryAdmissionDenialReason =
  'REGISTRY_UNAVAILABLE' | 'ARTIFACT_NOT_FOUND' | 'AMBIGUOUS_ARTIFACT_ID' | 'CONTENT_HASH_MISMATCH';

export interface RegistryAdmissionCheckResult {
  readonly ok: boolean;
  /** Present only when ok is false. One value per materially distinct authority failure. */
  readonly reason?: RegistryAdmissionDenialReason;
  readonly detail: string;
}

/**
 * The minimum this package needs to know about one verified registry entry. Structural on
 * purpose: it is satisfied by `VerifiedSourceDefinition` from `mps-data-governance` without this
 * package importing that type, or that package.
 */
export interface VerifiedRegistryEntrySnapshot {
  readonly registryArtifactId: string;
  readonly sourceContentHash: string;
}

/**
 * Injected port. Implementations MUST return only entries that are currently APPROVED and
 * cryptographically verified, and MUST throw (never return an empty or partial list) when the
 * registry cannot be loaded or verified — a swallowed failure here would become a silent
 * `ARTIFACT_NOT_FOUND` instead of the `REGISTRY_UNAVAILABLE` the authority boundary requires.
 */
export interface VerifiedRegistrySnapshotProvider {
  loadApprovedEntries(): Promise<readonly VerifiedRegistryEntrySnapshot[]>;
}

export interface RegistryAdmissionAuthority {
  /**
   * `registryArtifactId` names which SourceRegistryArtifact the caller claims this content
   * originates from; `registrySourceContentHash` is the claimed value of that artifact's own
   * signed content hash. Both are caller-supplied identifiers to look up — never trusted as
   * authority in themselves. Authority is only ever what the injected provider resolves from
   * the verified signed registry.
   */
  checkAdmissible(
    registryArtifactId: string,
    registrySourceContentHash: string,
  ): Promise<RegistryAdmissionCheckResult>;
}

export function createRegistryAdmissionAuthority(
  provider: VerifiedRegistrySnapshotProvider,
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

      let entries: readonly VerifiedRegistryEntrySnapshot[];
      try {
        entries = await provider.loadApprovedEntries();
      } catch (err) {
        // Fail closed: a registry that cannot be loaded/verified at all (missing file, missing
        // key configuration, or ANY single entry in it failing verification — the underlying
        // registry load is atomic) is authority UNAVAILABLE, never "skip this check" or "treat
        // as approved".
        return {
          ok: false,
          reason: 'REGISTRY_UNAVAILABLE',
          detail: `verified source registry could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // K2.1b finding 3: the underlying registry loader guarantees a unique `source_id`, NOT a
      // unique `artifact_id`. Two APPROVED entries could therefore carry the same artifact_id,
      // and a first-match lookup would silently pick one and bind admission to an authority the
      // reviewer never disambiguated. Ambiguity is refused rather than resolved by position.
      const matches = entries.filter((entry) => entry.registryArtifactId === registryArtifactId);
      if (matches.length === 0) {
        // Reached both by a fabricated artifact_id that never existed, and by an artifact_id
        // that WAS a real approved source but is no longer present in the active registry
        // (this repo's own convention for revocation/supersession is removal from
        // source-registry/national-registry.json, not an in-file REJECTED/QUARANTINED marker
        // left behind). Both mean the same thing for a NEW admission: not currently usable.
        return {
          ok: false,
          reason: 'ARTIFACT_NOT_FOUND',
          detail: `no currently APPROVED source registry entry has artifact_id '${registryArtifactId}'.`,
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          reason: 'AMBIGUOUS_ARTIFACT_ID',
          detail:
            `${matches.length} currently APPROVED source registry entries share artifact_id ` +
            `'${registryArtifactId}'. A corpus admission must bind to exactly one authority; ` +
            'withdraw the duplicate before admitting content under it.',
        };
      }

      const source = matches[0];
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
