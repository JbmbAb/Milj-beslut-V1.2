import { describe, it, expect, beforeAll } from "vitest";
import { ViewerKernel } from "../src/viewer/ViewerKernel";
import { transformGeometryToWgs84 } from "../src/viewer/GeoJsonCoordinateTransform";
import { buildAdmittedViewerCapability } from "./fixtures/admittedViewerCapability";
import { MimersIntegration } from "../../mps-runtime/src/mimers";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

/**
 * LU-CESIUM-GEOJSON-CRS-COMPATIBILITY-01.
 *
 * Real, browser-observed failure this closes: Cesium's GeoJsonDataSource.load() rejected the
 * governed viewer FeatureCollection with "Unknown crs name: urn:ogc:def:crs:EPSG::3006" --
 * ViewerKernel.exportAsGeoJSON always declared that legacy `crs` member, regardless of whether
 * any feature actually had geometry needing it. Fixed by never emitting a `crs` member (RFC 7946
 * transport is always WGS84) and transforming any non-null geometry to WGS84 for real, preserving
 * the canonical source SRID as feature-property provenance rather than dropping or falsifying it.
 */
function evidenceArtifact(overrides: {
  artifact_id: string;
  geometry: SpatialEvidenceArtifact["payload"]["geometry"];
  srid: number;
  semanticsKind?: "EXISTENCE_WITHIN_DISTANCE";
}): SpatialEvidenceArtifact {
  return {
    artifact_id: overrides.artifact_id,
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `hash-${overrides.artifact_id}` },
    references: [{ artifact_id: "prop-1", artifact_type: "PROPERTY" }],
    payload: {
      result_semantics: {
        kind: overrides.semanticsKind ?? "EXISTENCE_WITHIN_DISTANCE",
        query: { subject_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" }, srid: overrides.srid, distance_meters: 500 },
        result: { exists: overrides.geometry !== null, match_count_observed: overrides.geometry !== null ? 1 : 0, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" },
      geometry: overrides.geometry,
      srid: overrides.srid,
      operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS", engine_fingerprint: SPATIAL_STACK_V1 },
      layer_ref: { layer_id: "water", version_hash: "v1hash", layer_version: "v1" },
      source_metadata: { provider: "SGU", dataset: "water", dataset_version: "v1hash", retrieved_at: new Date().toISOString() },
      query_context: { query_id: "q1", query_type: "SPATIAL_DWITHIN", parameters: { property_ref: { artifact_id: "prop-1", artifact_type: "PROPERTY" }, search_distance_meters: 500 } },
    },
  } as unknown as SpatialEvidenceArtifact;
}

describe("transformGeometryToWgs84 (pure function)", () => {
  it("null geometry passes through unchanged, no transform attempted", () => {
    expect(transformGeometryToWgs84(null, 3006)).toBeNull();
  });

  it("already-4326 geometry is returned unchanged (no accidental double-transform)", () => {
    const geometry = { type: "Polygon" as const, coordinates: [[[14.6, 61.1], [14.7, 61.1], [14.7, 61.2], [14.6, 61.1]]] };
    expect(transformGeometryToWgs84(geometry, 4326)).toEqual(geometry);
  });

  it("EPSG:3006 (SWEREF99 TM) geometry transforms to real, valid WGS84 coordinates", () => {
    // A real SWEREF99 TM point near central Sweden (central meridian 15E).
    const geometry = { type: "Polygon" as const, coordinates: [[[500000, 6800000], [500100, 6800000], [500100, 6800100], [500000, 6800000]]] };
    const result = transformGeometryToWgs84(geometry, 3006);
    expect(result!.type).toBe("Polygon");
    for (const ring of result!.coordinates) {
      for (const [lng, lat] of ring) {
        expect(lng).toBeGreaterThan(-180);
        expect(lng).toBeLessThan(180);
        expect(lat).toBeGreaterThan(-90);
        expect(lat).toBeLessThan(90);
        // Central-meridian point must land essentially on 15E.
      }
    }
    expect(result!.coordinates[0][0][0]).toBeCloseTo(15, 1);
    expect(result!.coordinates[0][0][1]).toBeCloseTo(61.33, 1);
  });

  it("unknown/untransformable SRID fails closed (throws) rather than mis-projecting", () => {
    const geometry = { type: "Polygon" as const, coordinates: [[[1, 1], [2, 1], [2, 2], [1, 1]]] };
    expect(() => transformGeometryToWgs84(geometry, 9999)).toThrow(/REJECT_GEOJSON_COORDINATE_TRANSFORM/);
  });

  it("same input -> same deterministic output (no randomness/clock in the transform)", () => {
    const geometry = { type: "Polygon" as const, coordinates: [[[500000, 6800000], [500100, 6800000], [500100, 6800100], [500000, 6800000]]] };
    expect(transformGeometryToWgs84(geometry, 3006)).toEqual(transformGeometryToWgs84(geometry, 3006));
  });
});

describe("ViewerKernel.exportAsGeoJSON CRS transport (LU-CESIUM-GEOJSON-CRS-COMPATIBILITY-01)", () => {
  let casRepo: any;
  let viewer: ViewerKernel;

  beforeAll(async () => {
    const mimers = await MimersIntegration.create();
    casRepo = mimers.artifactRepository;
    viewer = new ViewerKernel(casRepo, buildAdmittedViewerCapability("crs-fix"));
  });

  it("all geometry:null -> no unsupported crs declaration, features keep geometry:null", async () => {
    const artifact = evidenceArtifact({ artifact_id: "ev-null-geom", geometry: null, srid: 3006 });
    await casRepo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });

    const geojson = await viewer.exportAsGeoJSON([artifact.artifact_id]);
    expect(geojson.crs).toBeUndefined();
    expect(geojson.features[0].geometry).toBeNull();
    expect(geojson.features[0].properties.source_srid).toBeUndefined();
  });

  it("same governed artifact exported twice -> byte-identical deterministic presentation", async () => {
    const artifact = evidenceArtifact({ artifact_id: "ev-deterministic", geometry: null, srid: 3006 });
    await casRepo.put({ artifact_id: artifact.artifact_id, content_hash: artifact.content_hash, body: artifact });

    const first = await viewer.exportAsGeoJSON([artifact.artifact_id]);
    const second = await viewer.exportAsGeoJSON([artifact.artifact_id]);
    expect(first).toEqual(second);
  });
});
