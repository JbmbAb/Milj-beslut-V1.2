import { FrozenCoreReleaseManifestArtifact } from "../FrozenCoreReleaseManifestArtifact";
import { createFrozenCoreReleaseProjection } from "../FrozenCoreReleaseManifestProjectionFactory";
import { sha256CanonicalJson } from "../../../../mps-compliance/src/canonical/sha256Canonical";

const MATRIX_HASH = {
  algorithm: "sha256" as const,
  value: sha256CanonicalJson({ matrix_id: "mcs-001", version: "1.0.0" }),
};

const REGISTRY_HASH = {
  algorithm: "sha256" as const,
  value: sha256CanonicalJson({ registry: "frozen-core-v1", version: "1.0.0" }),
};

const DEPENDENCY_GRAPH_HASH = {
  algorithm: "sha256" as const,
  value: sha256CanonicalJson({
    packages: ["mps-compliance", "mps-governance", "mps-runtime"],
  }),
};

const BASE_MANIFEST = {
  artifact_id: "frozen-core-release-v1.0.0",
  artifact_type: "frozen_core_release_manifest" as const,
  release_id: "frozen-core-v1",
  release_version: "1.0.0",
  matrix_id: "mcs-001",
  matrix_hash: MATRIX_HASH,
  registry_hash: REGISTRY_HASH,
  canonical_rules_version: "1.0.0",
  package_versions: [
    { package_name: "mps-compliance", version: "1.0.0" },
    { package_name: "mps-governance", version: "1.0.0" },
    { package_name: "mps-runtime", version: "1.0.0" },
  ],
  dependency_graph_hash: DEPENDENCY_GRAPH_HASH,
  compliance_evaluation_ref: {
    artifact_id: "eval-v1",
    artifact_type: "compliance_evaluation" as const,
  },
  released_at: "2026-08-04T00:00:00Z",
  references: [] as const,
};

/** Placeholder hashes excluded from projection; recomputed below. */
const PLACEHOLDER = { algorithm: "sha256" as const, value: "pending" };

const projection = createFrozenCoreReleaseProjection({
  ...BASE_MANIFEST,
  release_hash: PLACEHOLDER,
  content_hash: PLACEHOLDER,
});

const RELEASE_HASH = {
  algorithm: "sha256" as const,
  value: sha256CanonicalJson(projection),
};

/**
 * Frozen Core v1.0.0 — content hashes are real SHA-256 over canonical projections.
 */
export const FROZEN_CORE_V1_MANIFEST: FrozenCoreReleaseManifestArtifact = {
  ...BASE_MANIFEST,
  release_hash: RELEASE_HASH,
  content_hash: RELEASE_HASH,
};
