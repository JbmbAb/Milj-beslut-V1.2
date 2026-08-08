import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import type { ViewerCapabilityArtifact } from "../../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";

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

      if (!artifact.payload.geometry) {
        continue;
      }

      // 2. Map to GeoJSON Feature
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
