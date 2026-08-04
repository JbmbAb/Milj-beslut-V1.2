import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";
import { ArtifactReference } from "../../../mps-compliance/src/artifacts/ArtifactReference";
import { ContentHash } from "../../../mps-compliance/src/artifacts/ContentHash";
import { PackageVersionBinding } from "./FrozenCoreReleaseManifestProjection";

export interface FrozenCoreReleaseManifestArtifact extends ArtifactContract {
  readonly artifact_type: "frozen_core_release_manifest";

  readonly release_id: string;
  readonly release_version: string;

  readonly matrix_id: string;
  readonly matrix_hash: ContentHash;

  readonly registry_hash: ContentHash;

  readonly canonical_rules_version: string;

  readonly package_versions: readonly PackageVersionBinding[];

  readonly dependency_graph_hash: ContentHash;

  readonly compliance_evaluation_ref: ArtifactReference;

  readonly release_hash: ContentHash;

  readonly released_at: string;

  readonly release_signature_ref?: ArtifactReference;
}
