import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import type { ViewerCapabilityArtifact } from "../../../mps-compliance/src/artifacts/ViewerCapabilityArtifact.js";
import {
  assertGeometryMatchesSemantics,
  isAdmittedSemanticsKind,
} from "../artifacts/SpatialResultSemantics.js";
import { transformGeometryToWgs84 } from "./GeoJsonCoordinateTransform.js";

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
      //
      // LU-CESIUM-GEOJSON-CRS-COMPATIBILITY-01: when geometry is non-null, the canonical
      // evidence CRS (artifact.payload.srid) is NOT the GeoJSON transport CRS -- RFC 7946
      // coordinates are always WGS84. Transform for transport; keep the source SRID as
      // provenance on the feature rather than silently discarding or falsifying it. A geometry
      // in an SRID with no known projection fails closed (throws) rather than rendering
      // mis-projected coordinates.
      const sourceSrid = artifact.payload.srid;
      const transportGeometry = transformGeometryToWgs84(artifact.payload.geometry, sourceSrid);

      features.push({
        type: "Feature",
        geometry: transportGeometry,
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
          ...(transportGeometry !== null ? { source_srid: sourceSrid } : {}),
        },
      });
    }

    // RFC 7946: GeoJSON coordinates are always WGS84; there is no `crs` member to declare --
    // every feature's geometry above is either null or already transformed to WGS84, so this
    // FeatureCollection is spec-compliant transport as-is. A legacy `crs` member here is exactly
    // what Cesium's GeoJsonDataSource rejected (`Unknown crs name`); the source SRID is provenance
    // carried per-feature (`source_srid`), never a transport-level claim.
    return {
      type: "FeatureCollection",
      features,
    };
  }
}
