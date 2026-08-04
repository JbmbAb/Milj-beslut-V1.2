import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";

export interface FrozenCoreReleaseManifestProjection {
  readonly release_version: string;

  readonly matrix_id: string;
  readonly matrix_hash: ContentHash;

  readonly registry_hash: ContentHash;

  readonly canonical_rules_version: string;

  readonly package_versions: readonly PackageVersionBinding[];

  readonly dependency_graph_hash: ContentHash;

  readonly compliance_evaluation_ref: ArtifactReference;
}

export interface PackageVersionBinding {
  readonly package_name: string;
  readonly version: string;
}
