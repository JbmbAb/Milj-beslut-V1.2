import { createHash } from "node:crypto";

import { canonicalizeStrict } from "@miljobeslut/mimers-brunn-core";

import type { ContentReference } from "../../mps-core/src/types";
import type { DownloadManifest } from "./GovernedDownloadContracts";

/**
 * 🜃 Download manifest identity (P2-EXEC-IDENTITY)
 *
 * A manifest identity answers ONE question:
 *
 *   what was fetched, from which approved source, under which governed contract?
 *
 * It must not answer "how did this particular run go". The defect this closes was exactly that
 * conflation: `deduplicated` and `attempts` sat inside the hash domain, so the second run of an
 * identical download produced a different identity — the first run stored the bytes, the second
 * deduplicated them. Reproducibility was unobservable precisely when it held.
 *
 * The canonical version is part of the hash domain rather than metadata beside it, so two
 * canonicalization rules can never collapse into one identity. Same discipline as
 * `SPATIAL_CANONICAL_VERSION` (C-02) applied to the download domain.
 *
 * @see ./GovernedDownloadExecutor.ts
 * @see ../../mps-lu/src/artifacts/SpatialEvidenceIdentity.ts (the precedent)
 */
export const DOWNLOAD_MANIFEST_CANONICAL_VERSION = "dl-canonical-1" as const;

/**
 * Fields that record how a run behaved rather than what it obtained.
 *
 * Kept in the manifest — they are useful provenance — but excluded from identity. Listed
 * explicitly rather than filtered ad hoc, so adding a field to `DownloadedObject` forces a
 * deliberate decision about which side of the line it falls on.
 */
export const EXECUTION_STATE_FIELDS = ["deduplicated", "attempts"] as const;

/**
 * Identity inputs only.
 *
 * `generated_at` is wall-clock provenance (IMPORT-TIME-001 / SV-I06): including it would mean an
 * identical re-execution produces a different hash, i.e. replay could never match.
 *
 * Objects are ordered by content hash, then URL. The manifest describes the SET of objects
 * obtained under the contract, not the sequence a resolver happened to emit them in — and a
 * resolver reordering its output is not a different download. This is a judgement, and it is
 * made here rather than left to the caller so it cannot vary per adapter.
 */
export function buildDownloadManifestIdentityPayload(
  manifest: DownloadManifest,
): Record<string, unknown> {
  return {
    manifest_version: manifest.manifest_version,
    execution_id: manifest.execution_id,
    source_id: manifest.source_id,
    // Binds WHICH registry entry authorised the run: a re-approved source with different policy
    // must not be able to produce an identical manifest identity.
    source_content_hash: manifest.source_content_hash,
    registry_artifact_id: manifest.registry_artifact_id,
    objects: [...manifest.objects]
      .map((object) => ({
        quarantine_id: object.quarantine_id,
        source_id: object.source_id,
        url: object.url,
        file_name: object.file_name,
        content_hash: object.content_hash,
        byte_length: object.byte_length,
      }))
      .sort((a, b) =>
        a.content_hash === b.content_hash
          ? a.url.localeCompare(b.url)
          : a.content_hash.localeCompare(b.content_hash),
      ),
  };
}

/** manifest_hash = SHA256( canonical_version || "\n" || canonical_payload ) */
export function computeDownloadManifestHash(manifest: DownloadManifest): string {
  const canonical = canonicalizeStrict(buildDownloadManifestIdentityPayload(manifest));
  return createHash("sha256")
    .update(`${DOWNLOAD_MANIFEST_CANONICAL_VERSION}\n${canonical}`, "utf8")
    .digest("hex");
}

export function buildDownloadManifestRef(manifest: DownloadManifest): ContentReference {
  const digest = computeDownloadManifestHash(manifest);
  return {
    id: `download-manifest-${manifest.execution_id}-${digest.slice(0, 16)}`,
    content_hash: { algorithm: "sha256", digest },
  };
}
