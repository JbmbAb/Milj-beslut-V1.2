import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import type { ViewerCapabilityArtifact } from "../../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import {
  assertGeometryMatchesSemantics,
  isAdmittedSemanticsKind,
} from "../artifacts/SpatialResultSemantics.js";

/**
 * ViewerKernel guarantees that Observation != Authority.
 * It reads immutable artifacts from CAS and projects them into viewer-compatible formats (e.g. GeoJSON for QGIS),
 * ensuring that QGIS never queries the spatial database directly for evidence.
 */
export class ViewerKernel {
  constructor(
    private readonly cas: ArtifactRepositoryPort,
    private readonly capability: ViewerCapabilityArtifact
  ) {}

  /**
   * Resolves a set of Spatial Evidence Artifacts from CAS and exports them as a GeoJSON FeatureCollection.
   * This is the only path QGIS is allowed to take to retrieve spatial evidence.
   */
  async exportAsGeoJSON(evidenceArtifactIds: string[]): Promise<any> {
    if (!this.capability.release_hash?.value) {
      throw new Error("ViewerCapabilityArtifact lacks a verified release_hash");
    }
    if (!this.capability.viewer_identity_ref?.artifact_id) {
      throw new Error("ViewerCapabilityArtifact lacks viewer_identity_ref provenance");
    }

    const features = [];

    for (const artifactId of evidenceArtifactIds) {
      // 1. Resolve from CAS - Guarantees Canonical Truth
      const artifact = await this.cas.resolve<SpatialEvidenceArtifact>({
        artifact_id: artifactId,
        artifact_type: "SPATIAL_EVIDENCE",
      });

      if (!artifact) {
        throw new Error(`Artifact ${artifactId} not found or is not SPATIAL_EVIDENCE.`);
      }

      if (artifact.artifact_type !== "SPATIAL_EVIDENCE") {
        throw new Error(`Artifact ${artifactId} is not SPATIAL_EVIDENCE.`);
      }

      const semantics = artifact.payload.result_semantics;
      if (!semantics || !isAdmittedSemanticsKind(semantics.kind)) {
        throw new Error(
          `REJECT_VIEWER_SPATIAL_SEMANTICS: ${artifactId} has no admitted result semantics.`,
        );
      }
      assertGeometryMatchesSemantics(semantics, artifact.payload.geometry);

      // GeoJSON permits `geometry: null`. Under EXISTENCE_WITHIN_DISTANCE this is the honest
      // representation: the evidence answers whether a match exists but contains no feature
      // geometry. Presentation metadata carries that answer without inventing a polygon.
      features.push({
        type: "Feature",
        geometry: artifact.payload.geometry,
        properties: {
          cas_artifact_id: artifact.artifact_id,
          cas_content_hash: artifact.content_hash.value,
          dataset: artifact.payload.source_metadata.dataset,
          version: artifact.payload.source_metadata.dataset_version,
          engine: artifact.payload.operation.engine,
          algorithm: artifact.payload.operation.algorithm,
          result_semantics_kind: semantics.kind,
          exists: semantics.result.exists,
          distance_meters: semantics.query.distance_meters,
          match_count_observed: semantics.result.match_count_observed,
          max_features_per_layer: semantics.result.max_features_per_layer,
          subject_artifact_id: semantics.query.subject_ref.artifact_id,
          layer_id: artifact.payload.layer_ref.layer_id,
          layer_version_hash: artifact.payload.layer_ref.version_hash,
          presentation_mode: "NON_GEOMETRIC_SPATIAL_OBSERVATION",
          // Explicitly mark as an Observation
          governance_status: "VERIFIED_OBSERVATION",
          viewer_capability_id: this.capability.artifact_id,
          viewer_release_hash: this.capability.release_hash.value,
          viewer_identity_ref: this.capability.viewer_identity_ref.artifact_id,
        },
      });
    }

    return {
      type: "FeatureCollection",
      crs: {
        type: "name",
        properties: { name: "urn:ogc:def:crs:EPSG::3006" }, // Swedish coordinate system
      },
      features,
    };
  }
}
