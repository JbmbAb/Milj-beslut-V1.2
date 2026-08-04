import { FrozenCoreReleaseManifestArtifact } from "./FrozenCoreReleaseManifestArtifact";
import { FrozenCoreReleaseManifestProjection } from "./FrozenCoreReleaseManifestProjection";

export function createFrozenCoreReleaseProjection(
  manifest: FrozenCoreReleaseManifestArtifact
): FrozenCoreReleaseManifestProjection {
  const sortedPackages = Object.freeze(
    [...manifest.package_versions].sort((a, b) =>
      a.package_name.localeCompare(b.package_name)
    )
  );

  return {
    release_version: manifest.release_version,
    matrix_id: manifest.matrix_id,
    matrix_hash: manifest.matrix_hash,
    registry_hash: manifest.registry_hash,
    canonical_rules_version: manifest.canonical_rules_version,
    package_versions: sortedPackages,
    dependency_graph_hash: manifest.dependency_graph_hash,
    compliance_evaluation_ref: manifest.compliance_evaluation_ref
  };
}
