import type { ArtifactContract } from "../../mps-compliance/src/artifacts/ArtifactContract.js";
import type { ArtifactReference } from "../../mps-compliance/src/artifacts/ArtifactReference.js";
import type { ViewerCapabilityArtifact } from "../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import type { ContentHash } from "../../mps-compliance/src/artifacts/ContentHash.js";
import type { ArtifactReader } from "../../mps-compliance/src/audit/ProofPathResolver.js";

export const RELEASE_HASH = "a".repeat(64);

export function sha(value: string): ContentHash {
  return { algorithm: "sha256", value };
}

export function makeCapability(
  overrides: Partial<ViewerCapabilityArtifact> = {},
): ViewerCapabilityArtifact {
  const base: ViewerCapabilityArtifact = {
    artifact_id: "cap-1",
    artifact_type: "viewer_capability",
    content_hash: sha("cap-1"),
    references: [],
    viewer_identity_ref: { artifact_id: "viewer-1", artifact_type: "viewer_identity" },
    granted_by: { artifact_id: "grant-1", artifact_type: "capability_grant" },
    policy_ref: { artifact_id: "policy-1", artifact_type: "policy" },
    release_hash: sha(RELEASE_HASH),
    valid_from: "2020-01-01T00:00:00.000Z",
    valid_until: "2099-01-01T00:00:00.000Z",
    can_view_domain_evidence: true,
    allowed_operations: ["inspect", "export", "resolve_proof"],
    denied_operations: [],
  };
  return { ...base, ...overrides };
}

export function memoryReader(artifacts: ArtifactContract[]): ArtifactReader {
  const map = new Map(artifacts.map((a) => [a.artifact_id, a]));
  return {
    read(ref: ArtifactReference): ArtifactContract | null {
      return map.get(ref.artifact_id) ?? null;
    },
  };
}

export function leafArtifact(id: string): ArtifactContract {
  return {
    artifact_id: id,
    artifact_type: "domain_evidence",
    content_hash: sha(id),
    references: [],
  };
}
