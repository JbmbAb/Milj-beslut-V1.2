import { describe, it, expect, beforeAll } from "vitest";
import { ViewerKernel } from "../src/viewer/ViewerKernel";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";

describe("TV-4.2: QGIS Integration Architecture", () => {
  let casRepo: any;
  let viewer: ViewerKernel;
  let evidenceArtifactId: string;

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;
    const mockCapability: any = {
      artifact_id: "viewer-cap-mock",
      artifact_type: "viewer_capability",
      release_hash: { algorithm: "sha256", value: "mock-release-hash" }
    };
    viewer = new ViewerKernel(casRepo, mockCapability);

    const spatialEvidence: SpatialEvidenceArtifact = {
      artifact_id: "spatial-qgis-test-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "hash_for_qgis_test" },
      references: [{ artifact_id: "prop-1", artifact_type: "PROPERTY" }],
      payload: {
        geometry: {
          type: "Polygon",
          coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
        },
        srid: 3006,
        operation: { algorithm: "ST_DWithin", engine: "PostGIS", engine_fingerprint: {} },
        layer_ref: { layer_id: "water", layer_version: "v1" },
        source_metadata: { provider: "Test", dataset: "water", dataset_version: "v1", retrieved_at: new Date().toISOString() },
        query_context: { query_id: "q1", query_type: "SPATIAL_DWITHIN", parameters: { property_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" }, search_distance_meters: 100 } }
      }
    };

    evidenceArtifactId = spatialEvidence.artifact_id;
    await casRepo.put({
      artifact_id: spatialEvidence.artifact_id,
      content_hash: spatialEvidence.content_hash,
      body: spatialEvidence
    });
  });

  it("should extract Verified Observation as GeoJSON from CAS, strictly separating Observation from Authority", async () => {
    const geojson = await viewer.exportAsGeoJSON([evidenceArtifactId]);
    
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.crs.properties.name).toBe("urn:ogc:def:crs:EPSG::3006");
    expect(geojson.features).toHaveLength(1);
    
    const feature = geojson.features[0];
    expect(feature.geometry.type).toBe("Polygon");
    
    // Crucial: The observation must carry CAS traceability
    expect(feature.properties.cas_artifact_id).toBe(evidenceArtifactId);
    expect(feature.properties.cas_content_hash).toBe("hash_for_qgis_test");
    expect(feature.properties.governance_status).toBe("VERIFIED_OBSERVATION");
  });
});
