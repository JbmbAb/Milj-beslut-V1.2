import { describe, it, expect, beforeAll } from "vitest";
import { ViewerKernel } from "../src/viewer/ViewerKernel";
import { buildAdmittedViewerCapability } from "./fixtures/admittedViewerCapability";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

describe("TV-4.2: QGIS Integration Architecture", () => {
  let casRepo: any;
  let viewer: ViewerKernel;
  let evidenceArtifactId: string;

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;
    // F8 2026-08-13: same hand-built capability defect as VerticalProof had. Left unfixed it
    // would keep an inadmissible capability alive in the suite, which is the defect itself.
    viewer = new ViewerKernel(casRepo, buildAdmittedViewerCapability("qgis"));

    const spatialEvidence: SpatialEvidenceArtifact = {
      artifact_id: "spatial-qgis-test-1",
      artifact_type: "SPATIAL_EVIDENCE",
      content_hash: { algorithm: "sha256", value: "hash_for_qgis_test" },
      references: [{ artifact_id: "prop-1", artifact_type: "PROPERTY" }],
      payload: {
        result_semantics: {
          kind: "EXISTENCE_WITHIN_DISTANCE",
          query: {
            subject_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" },
            srid: 3006,
            distance_meters: 100,
          },
          result: {
            exists: true,
            match_count_observed: 1,
            max_features_per_layer: 50,
          },
        },
        property_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" },
        geometry: null,
        srid: 3006,
        operation: {
          algorithm: "spatial.dwithin_existence",
          engine: "PostGIS",
          engine_fingerprint: SPATIAL_STACK_V1,
        },
        layer_ref: {
          layer_id: "water",
          version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          layer_version: "v1",
        },
        source_metadata: {
          provider: "SGU",
          dataset: "water",
          dataset_version: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
          retrieved_at: new Date().toISOString(),
        },
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
    expect(feature.geometry).toBeNull();
    expect(feature.properties.result_semantics_kind).toBe("EXISTENCE_WITHIN_DISTANCE");
    expect(feature.properties.exists).toBe(true);
    expect(feature.properties.distance_meters).toBe(100);
    
    // Crucial: The observation must carry CAS traceability
    expect(feature.properties.cas_artifact_id).toBe(evidenceArtifactId);
    expect(feature.properties.cas_content_hash).toBe("hash_for_qgis_test");
    expect(feature.properties.governance_status).toBe("VERIFIED_OBSERVATION");
  });
});
