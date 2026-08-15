import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { VerificationKeyProvider } from '@miljobeslut/mimers-brunn-core';

import {
  getSourceRegistryPathFromEnv,
  getSourceRegistryVerificationKeyFromEnv,
  verifySourceRegistryArtifact,
  type SourceRegistryArtifact,
} from './SourceRegistry';

/**
 * 🜃 VERIFIED_SOURCE_AUTHORITY_HISTORY_V1 — resolving the authority material was acquired under.
 *
 * A quarantined object names the exact SourceRegistry artifact that authorised its acquisition.
 * That artifact may since have been superseded: the 144 MMÖD judgments harvested before the PUH
 * object-size reissue name `reg-dv-puh-mmod-002`, which is no longer in the active registry.
 * Resolving them against `-003` because it is what is active today would misattribute the scope
 * they were actually collected under.
 *
 * The contract:
 *
 *   1. the caller names an exact artifact_id
 *   2. it is located in the active registry OR an explicitly approved historical store
 *   3. the located artifact still carries its original approval attestation
 *   4. the signature verifies against the trusted verification key
 *   5. source_id binding is checked by the caller against its own record
 *   6. the archival wrapper cannot alter the signed payload — verification recomputes the
 *      content hash from the entry itself, so any mutation breaks `subjectDigest`
 *   7. active state is NEVER substituted for historical state
 *
 * ⚠️ The historical store is an explicit path allowlist, not a directory scan. Scanning
 * `source-registry/legacy/` would make dropping a file there sufficient to create an authority —
 * the same defect the `.gitignore` allowlist exists to prevent, one layer down.
 *
 * Verification capability only. This module never signs and never mutates a registry.
 *
 * @see ./SourceRegistry.ts
 * @see ../../mps-lu/src/loke/GovernedQuarantineBridge.ts (consumes this, structurally)
 */

/** The narrow projection a consumer receives. Deliberately not the whole artifact. */
export interface VerifiedSourceAuthority {
  readonly registryArtifactId: string;
  readonly sourceId: string;
  readonly authorityName: string;
  /** True when this authority is no longer the active one for its source. */
  readonly superseded: boolean;
}

/** An archival wrapper as written by the supersession ceremony. */
interface HistoricalAuthorityDocument {
  readonly _classification?: string;
  readonly _authority?: string;
  readonly _status?: string;
  readonly _superseded_by?: string;
  readonly entries?: readonly SourceRegistryArtifact[];
}

export class SourceAuthorityHistoryError extends Error {
  constructor(
    message: string,
    readonly reason_code: string,
  ) {
    super(message);
    this.name = 'SourceAuthorityHistoryError';
  }
}

/** Historical stores admitted by name. Adding a file to legacy/ is not enough to be consulted. */
export const APPROVED_HISTORICAL_STORES = Object.freeze([
  'source-registry/legacy/puh-mmod-001-superseded.json',
  'source-registry/legacy/puh-mmod-002-superseded.json',
]);

export interface SourceAuthorityHistoryOptions {
  readonly registryPath?: string;
  /** Explicit allowlist. Defaults to APPROVED_HISTORICAL_STORES. */
  readonly historicalStorePaths?: readonly string[];
  readonly signing?: VerificationKeyProvider;
}

/**
 * Loads active and historical authorities, verifying every one.
 *
 * Satisfies the consumer's lookup port structurally — no cross-package import in either
 * direction, so LU depends on a shape rather than on this package.
 */
export async function loadSourceAuthorityHistory(
  options: SourceAuthorityHistoryOptions = {},
): Promise<{ findByArtifactId(artifactId: string): VerifiedSourceAuthority | null }> {
  const signing = options.signing ?? getSourceRegistryVerificationKeyFromEnv();
  const registryPath = options.registryPath ?? getSourceRegistryPathFromEnv();
  const byArtifactId = new Map<string, VerifiedSourceAuthority>();

  const admit = async (
    entry: SourceRegistryArtifact,
    origin: string,
    superseded: boolean,
  ): Promise<void> => {
    // Verification is what enforces contract items 3, 4 and 6 at once: it re-derives the
    // content hash from the entry and binds it to the attestation, so a wrapper that edited
    // the payload — or an entry with no attestation at all — cannot pass.
    const verified = await verifySourceRegistryArtifact(entry, signing);

    const existing = byArtifactId.get(verified.registryArtifactId);
    if (existing) {
      throw new SourceAuthorityHistoryError(
        `REJECT_DUPLICATE_AUTHORITY: '${verified.registryArtifactId}' appears in more than one ` +
          `store (last seen in ${origin}). An artifact id must identify exactly one authority, ` +
          'or resolution silently depends on load order.',
        'REJECT_DUPLICATE_AUTHORITY',
      );
    }

    byArtifactId.set(verified.registryArtifactId, {
      registryArtifactId: verified.registryArtifactId,
      sourceId: verified.sourceId,
      authorityName: verified.authority.name,
      superseded,
    });
  };

  // --- active authority -------------------------------------------------------------------
  const active = JSON.parse(readFileSync(registryPath, 'utf8')) as SourceRegistryArtifact[];
  if (!Array.isArray(active)) {
    throw new SourceAuthorityHistoryError(
      `REJECT_ACTIVE_REGISTRY_SHAPE: '${registryPath}' must be a JSON array.`,
      'REJECT_ACTIVE_REGISTRY_SHAPE',
    );
  }
  for (const entry of active) await admit(entry, registryPath, false);

  // --- historical authorities -------------------------------------------------------------
  for (const relativePath of options.historicalStorePaths ?? APPROVED_HISTORICAL_STORES) {
    const path = resolve(relativePath);
    let document: HistoricalAuthorityDocument;
    try {
      document = JSON.parse(readFileSync(path, 'utf8')) as HistoricalAuthorityDocument;
    } catch (error) {
      throw new SourceAuthorityHistoryError(
        `REJECT_HISTORICAL_STORE_UNREADABLE: '${relativePath}' is on the approved historical ` +
          `store list but could not be read: ${error instanceof Error ? error.message : String(error)}. ` +
          'A missing historical authority must stop resolution, not fall back to the active one.',
        'REJECT_HISTORICAL_STORE_UNREADABLE',
      );
    }

    if (!Array.isArray(document.entries)) {
      throw new SourceAuthorityHistoryError(
        `REJECT_HISTORICAL_STORE_SHAPE: '${relativePath}' has no 'entries' array.`,
        'REJECT_HISTORICAL_STORE_SHAPE',
      );
    }

    // Every entry is verified exactly as an active one would be. The archival wrapper marks the
    // file non-authoritative for LOADING, which is why it is never handed to
    // loadVerifiedSourceRegistry — but the signed entry inside it remains fully checkable, and
    // that is the whole point of keeping it.
    for (const entry of document.entries) await admit(entry, relativePath, true);
  }

  return {
    findByArtifactId(artifactId: string): VerifiedSourceAuthority | null {
      // Exact id only. No fallback to the source's currently active authority — that
      // substitution is precisely what item 7 forbids.
      return byArtifactId.get(artifactId) ?? null;
    },
  };
}
