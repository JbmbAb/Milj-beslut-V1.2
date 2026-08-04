import { FrozenCoreReleaseManifestArtifact } from "../FrozenCoreReleaseManifestArtifact";
import { ContentHash } from "../../../../mps-compliance/src/artifacts/ContentHash";

export const FROZEN_CORE_V1_MANIFEST: FrozenCoreReleaseManifestArtifact = {
  artifact_id: "frozen-core-release-v1.0.0",
  artifact_type: "frozen_core_release_manifest",
  release_id: "frozen-core-v1",
  release_version: "1.0.0",
  matrix_id: "mcs-001",
  matrix_hash: { algorithm: "sha256", value: "mock-matrix-hash" },
  registry_hash: { algorithm: "sha256", value: "mock-registry-hash" },
  canonical_rules_version: "1.0.0",
  package_versions: [
    { package_name: "mps-compliance", version: "1.0.0" },
    { package_name: "mps-governance", version: "1.0.0" },
    { package_name: "mps-runtime", version: "1.0.0" }
  ],
  dependency_graph_hash: { algorithm: "sha256", value: "mock-dependency-hash" },
  compliance_evaluation_ref: { artifact_id: "eval-v1", artifact_type: "compliance_evaluation" },
  release_hash: { algorithm: "sha256", value: "mock-hash" }, // Note: intentionally aligned with FROZEN_CORE_I7 mock validation
  released_at: "2026-08-04T00:00:00Z"
};
