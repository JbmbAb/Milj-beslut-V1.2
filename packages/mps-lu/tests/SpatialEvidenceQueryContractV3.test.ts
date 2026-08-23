import { describe, expect, it } from "vitest";
import {
  buildSpatialEvidenceContentHash,
  computeSpatialEvidenceHash,
  SPATIAL_CANONICAL_VERSION_V2,
  SPATIAL_CANONICAL_VERSION_V3,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type {
  SpatialEvidencePayload,
  SpatialEvidencePayloadV2,
  SpatialEvidencePayloadV3,
} from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import {
  SPATIAL_QUERY_CONTRACT_V2,
  SPATIAL_QUERY_CONTRACT_V3,
} from "../src/services/SpatialQueryContract";

const propertyRef = { artifact_id: "lu-property-context-v3", artifact_type: "LU_PROPERTY_CONTEXT" } as const;
const locationRef = { artifact_id: "localization-geometry-v3", artifact_type: "localization_geometry" } as const;
const layerHash = "b".repeat(64);

function base(distance_meters: number, max_features_per_layer: number) {
  return {
    result_semantics: {
      kind: "EXISTENCE_WITHIN_DISTANCE" as const,
      query: { subject_ref: propertyRef, srid: 3006, distance_meters },
      result: { exists: true, match_count_observed: 1, max_features_per_layer },
    },
    property_ref: propertyRef,
    layer_ref: { layer_id: "water", version_hash: layerHash, layer_version: "v1" },
    srid: 3006,
    operation: {
      algorithm: "spatial.dwithin_existence",
      engine: "PostGIS",
      engine_fingerprint: SPATIAL_STACK_V1,
    },
    geometry: null,
    source_metadata: {
      provider: "SGU",
      dataset: "water",
      dataset_version: layerHash,
      retrieved_at: "2026-08-23T00:00:00.000Z",
    },
  };
}

function v3(distance_meters = 500, max_features_per_layer = 50): SpatialEvidencePayloadV3 {
  return {
    ...base(distance_meters, max_features_per_layer),
    query_contract: {
      query_contract_version: SPATIAL_QUERY_CONTRACT_V3,
      spatial_canonical_version: SPATIAL_CANONICAL_VERSION_V3,
      relation: "DWITHIN",
      subject: {
        kind: "LOCALIZATION_GEOMETRY",
        property_context_ref: propertyRef,
        location_ref: locationRef,
        crs: "EPSG:3006",
      },
      parameters: { distance_meters, max_features_per_layer },
      selection: { predicate_semantics: "EXISTS" },
    },
  };
}

function v2(distance_meters = 500): SpatialEvidencePayloadV2 {
  return {
    ...base(distance_meters, 50),
    query_contract: {
      query_contract_version: SPATIAL_QUERY_CONTRACT_V2,
      relation: "DWITHIN",
      subject: {
        kind: "LOCALIZATION_GEOMETRY",
        property_context_ref: propertyRef,
        location_ref: locationRef,
        crs: "EPSG:3006",
      },
      parameters: { distance_meters, max_features_per_layer: 50 },
      selection: { predicate_semantics: "EXISTS" },
    },
  };
}

describe("SPATIAL-NUMERIC-CONTRACT-V1", () => {
  it("preserves historical V1 and decimal V2 identity semantics", () => {
    const historicalV1: SpatialEvidencePayload = {
      ...base(1500.5, 50),
      query_context: {
        query_id: "historical-v1",
        query_type: "SPATIAL_DWITHIN",
        parameters: { search_distance_meters: 1500.5 },
      },
    };

    expect(buildSpatialEvidenceContentHash(historicalV1)).toEqual(buildSpatialEvidenceContentHash(historicalV1));
    expect(() => computeSpatialEvidenceHash(v2(1500.5))).not.toThrow();
  });

  it.each([0, 1, 50, 2000, 5000])("accepts V3 whole-metre distance %s", (distance) => {
    expect(() => computeSpatialEvidenceHash(v3(distance))).not.toThrow();
  });

  it.each([0.3, 0.1 + 0.2, 1500.5, Number.NaN, Infinity, -Infinity, -1])(
    "rejects V3 non-canonical distance %s",
    (distance) => {
      expect(() => computeSpatialEvidenceHash(v3(distance))).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_V3_NUMERIC_PARAMETERS");
    },
  );

  it.each([1, 50, 5000])("accepts V3 integer limit %s", (limit) => {
    expect(() => computeSpatialEvidenceHash(v3(500, limit))).not.toThrow();
  });

  it.each([0, 50.5, Number.NaN, Infinity, -Infinity, -1])("rejects V3 invalid limit %s", (limit) => {
    expect(() => computeSpatialEvidenceHash(v3(500, limit))).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_V3_NUMERIC_PARAMETERS");
  });

  it("separates V2 and V3 identities for the same domain observation", () => {
    expect(computeSpatialEvidenceHash(v2(500))).not.toBe(computeSpatialEvidenceHash(v3(500)));
  });

  it("rejects mismatched and unknown query/canonical version combinations", () => {
    const v3WithV2Canonical = {
      ...v3(),
      query_contract: { ...v3().query_contract, spatial_canonical_version: SPATIAL_CANONICAL_VERSION_V2 },
    } as unknown as SpatialEvidencePayloadV3;
    const v2WithV3Canonical = {
      ...v2(),
      query_contract: { ...v2().query_contract, spatial_canonical_version: SPATIAL_CANONICAL_VERSION_V3 },
    } as unknown as SpatialEvidencePayloadV2;
    const unknownVersion = {
      ...v3(),
      query_contract: { ...v3().query_contract, query_contract_version: "spatial-query-contract-v4" },
    } as unknown as SpatialEvidencePayloadV3;

    expect(() => computeSpatialEvidenceHash(v3WithV2Canonical)).toThrow();
    expect(() => computeSpatialEvidenceHash(v2WithV3Canonical)).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_VERSION");
    expect(() => computeSpatialEvidenceHash(unknownVersion)).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_VERSION");
  });
});
