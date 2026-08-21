/**
 * LU-PRODUCT-GOLDEN-PATH-01.
 *
 * Resolves the current product release for execution-identity seed derivation and viewer
 * capability binding. This environment has exactly one real, owner-issued
 * `product_release_manifest` (`product-release-772aceb600c4690777593ea8`); there is no
 * multi-release selection mechanism yet, so that is what this resolves to by default. Overridable
 * via `PRODUCT_RELEASE_ARTIFACT_ID`/`PRODUCT_RELEASE_HASH` for a future environment with a real
 * release-selection authority -- not invented here, explicitly flagged as a known simplification
 * rather than silently hardcoded with no escape hatch.
 */
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";

const DEFAULT_RELEASE_ARTIFACT_ID = "product-release-772aceb600c4690777593ea8";
const DEFAULT_RELEASE_HASH = "772aceb600c4690777593ea89255ce20c062648eadf6ef6e0ecee3e36808c0fa";

export interface CurrentProductRelease {
  readonly releaseRef: ArtifactReference;
  readonly releaseHash: string;
}

/** Resolves the current release from the real CAS and verifies its declared hash matches. */
export async function resolveCurrentProductRelease(repo: ArtifactRepositoryPort): Promise<CurrentProductRelease> {
  const releaseRef: ArtifactReference = {
    artifact_id: process.env.PRODUCT_RELEASE_ARTIFACT_ID?.trim() || DEFAULT_RELEASE_ARTIFACT_ID,
    artifact_type: "product_release_manifest",
  };
  const expectedHash = process.env.PRODUCT_RELEASE_HASH?.trim() || DEFAULT_RELEASE_HASH;

  const release = await repo.resolve<{ release_hash?: { value: string } }>(releaseRef);
  if (release.release_hash?.value !== expectedHash) {
    throw new Error("REJECT_PRODUCT_RELEASE: resolved release_hash does not match expected");
  }
  return { releaseRef, releaseHash: expectedHash };
}
