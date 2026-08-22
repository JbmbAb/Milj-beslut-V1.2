import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSpatialEvidenceContentHash,
  computeSpatialEvidenceHash,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type {
  SpatialEvidencePayload,
  SpatialEvidencePayloadV2,
} from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

vi.mock("@miljobeslut/mps-lu", async () => {
  const identity = await import("../src/artifacts/SpatialEvidenceIdentity");
  const fingerprint = await import("../src/artifacts/SpatialEngineFingerprint");
  return {
    DEFAULT_SPATIAL_QUERY_BUDGET: {
      max_layers: 10,
      max_features_per_layer: 50,
      max_distance_meters: 5_000,
      timeout_ms: 10_000,
    },
    buildSpatialEvidenceContentHash: identity.buildSpatialEvidenceContentHash,
    SPATIAL_QUERY_CONTRACT_V2: "spatial-query-contract-v2",
    SPATIAL_STACK_V1: fingerprint.SPATIAL_STACK_V1,
    validateLocalizationGeometryArtifact: (artifact: { content_hash?: { value?: string } }) => {
      if (artifact.content_hash?.value !== "valid-localization-geometry") {
        throw new Error("REJECT_LOCALIZATION_GEOMETRY_TAMPERED");
      }
    },
  };
});

const propertyRef = { artifact_id: "lu-property-context-a", artifact_type: "LU_PROPERTY_CONTEXT" } as const;
const locationA = { artifact_id: "localization-geometry-a", artifact_type: "LOCALIZATION_GEOMETRY" } as const;
const locationB = { artifact_id: "localization-geometry-b", artifact_type: "LOCALIZATION_GEOMETRY" } as const;
const layerHash = "a".repeat(64);

function base(): Omit<SpatialEvidencePayloadV2, "query_contract"> {
  return {
    result_semantics: {
      kind: "EXISTENCE_WITHIN_DISTANCE",
      query: { subject_ref: propertyRef, srid: 3006, distance_meters: 500 },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: propertyRef,
    layer_ref: { layer_id: "water", version_hash: layerHash, layer_version: "v1" },
    srid: 3006,
    operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS", engine_fingerprint: SPATIAL_STACK_V1 },
    geometry: null,
    source_metadata: { provider: "SGU", dataset: "water", dataset_version: layerHash, retrieved_at: "2026-08-22T00:00:00.000Z" },
  };
}

function locationPayload(location_ref = locationA): SpatialEvidencePayloadV2 {
  return {
    ...base(),
    query_contract: {
      query_contract_version: "spatial-query-contract-v2",
      relation: "DWITHIN",
      subject: { kind: "LOCALIZATION_GEOMETRY", property_context_ref: propertyRef, location_ref, crs: "EPSG:3006" },
      parameters: { distance_meters: 500, max_features_per_layer: 50 },
      selection: { predicate_semantics: "EXISTS" },
    },
  };
}

describe("SPATIAL-EVIDENCE-QUERY-CONTRACT-V2-01", () => {
  it("binds distinct governed localization subjects even when geometry is null and results match", () => {
    expect(computeSpatialEvidenceHash(locationPayload(locationA))).not.toBe(computeSpatialEvidenceHash(locationPayload(locationB)));
    expect(computeSpatialEvidenceHash(locationPayload(locationA))).toBe(computeSpatialEvidenceHash(locationPayload(locationA)));
  });

  it("distinguishes a property centroid subject from a localization geometry subject", () => {
    const centroid: SpatialEvidencePayloadV2 = {
      ...base(),
      query_contract: {
        query_contract_version: "spatial-query-contract-v2",
        relation: "DWITHIN",
        subject: { kind: "PROPERTY_CONTEXT_CENTROID", property_context_ref: propertyRef, crs: "EPSG:3006" },
        parameters: { distance_meters: 500, max_features_per_layer: 50 },
        selection: { predicate_semantics: "EXISTS" },
      },
    };
    expect(computeSpatialEvidenceHash(centroid)).not.toBe(computeSpatialEvidenceHash(locationPayload()));
  });

  it("binds location_ref into the V2 content hash", () => {
    const original = locationPayload();
    expect(computeSpatialEvidenceHash(locationPayload(locationB))).not.toBe(computeSpatialEvidenceHash(original));
  });

  it.each([
    ["CRS", (payload: SpatialEvidencePayloadV2) => ({ ...payload, query_contract: { ...payload.query_contract, subject: { ...payload.query_contract.subject, crs: "EPSG:4326" as "EPSG:3006" } } })],
    ["distance", (payload: SpatialEvidencePayloadV2) => ({ ...payload, query_contract: { ...payload.query_contract, parameters: { ...payload.query_contract.parameters, distance_meters: 501 } } })],
    ["limit", (payload: SpatialEvidencePayloadV2) => ({ ...payload, query_contract: { ...payload.query_contract, parameters: { ...payload.query_contract.parameters, max_features_per_layer: 51 } } })],
  ])("rejects tampered %s instead of hashing contradictory V2 semantics", (_field, mutate) => {
    expect(() => computeSpatialEvidenceHash(mutate(locationPayload()))).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_V2");
  });

  it("rejects a tampered V2 contract version instead of treating it as V1", () => {
    const payload = locationPayload();
    expect(() => computeSpatialEvidenceHash({ ...payload, query_contract: { ...payload.query_contract, query_contract_version: "spatial-query-contract-v1" as "spatial-query-contract-v2" } })).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_V2");
  });

  it("fails closed when a deserialized V2 contract has a missing required block", () => {
    const payload = locationPayload();
    expect(() => computeSpatialEvidenceHash({
      ...payload,
      query_contract: { ...payload.query_contract, subject: undefined } as unknown as SpatialEvidencePayloadV2["query_contract"],
    })).toThrow("REJECT_SPATIAL_QUERY_CONTRACT_V2");
  });

  it("preserves V1 hashing without promoting its payload to V2", () => {
    const v1: SpatialEvidencePayload = {
      ...base(),
      query_context: {
        query_id: "historic-query",
        query_type: "SPATIAL_DWITHIN",
        parameters: { search_distance_meters: 500 },
      },
    };
    const historicHash = buildSpatialEvidenceContentHash(v1);
    expect(historicHash).toEqual(buildSpatialEvidenceContentHash(v1));
    expect(historicHash).not.toEqual(buildSpatialEvidenceContentHash(locationPayload()));
  });
});

describe("canonical PostGIS V2 producer", () => {
  const property = {
    artifact_id: "lu-property-context-a",
    artifact_type: "LU_PROPERTY_CONTEXT",
  } as const;
  const location = {
    artifact_id: "localization-geometry-a",
    artifact_type: "LOCALIZATION_GEOMETRY",
  } as const;
  let cas: {
    resolve: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    cas = {
      resolve: vi.fn(async (ref: { artifact_id: string }) => {
        if (ref.artifact_id === property.artifact_id) {
          return { payload: { coordinates: [6_777_905, 481_962] } };
        }
        if (ref.artifact_id === location.artifact_id) {
          return {
            content_hash: { value: "valid-localization-geometry" },
            payload: { property_context_ref: property, coordinates: [6_777_906, 481_963] },
          };
        }
        return undefined;
      }),
      put: vi.fn(),
    };
  });

  async function providerWithQueryStub() {
    const { SpatialProviderPostGIS } = await import("../../spatial-provider-postgis/src/SpatialProviderPostGIS");
    const provider = new SpatialProviderPostGIS("postgresql://unused", cas as never);
    (provider as unknown as { pool: { query: ReturnType<typeof vi.fn> } }).pool = {
      query: vi.fn(async () => ({ rowCount: 1, rows: [{ hit: 1 }] })),
    };
    return provider;
  }

  it("emits only a typed V2 contract from the canonical producer", async () => {
    const provider = await providerWithQueryStub();
    const [evidence] = await provider.query({
      property_ref: property,
      location_ref: location,
      layers: [{ name: "water", version_hash: "human-readable-label" }],
      buffer_distance_meters: 500,
    });

    expect(evidence.payload).toMatchObject({
      query_contract: {
        query_contract_version: "spatial-query-contract-v2",
        relation: "DWITHIN",
        subject: {
          kind: "LOCALIZATION_GEOMETRY",
          property_context_ref: property,
          location_ref: location,
          crs: "EPSG:3006",
        },
        parameters: { distance_meters: 500, max_features_per_layer: 50 },
        selection: { predicate_semantics: "EXISTS" },
      },
    });
    expect("query_context" in evidence.payload).toBe(false);
    expect(evidence.payload.geometry).toBeNull();
  });

  it("denies a localization geometry for another property before evidence creation", async () => {
    cas.resolve.mockImplementation(async (ref: { artifact_id: string }) => {
      if (ref.artifact_id === property.artifact_id) {
        return { payload: { coordinates: [6_777_905, 481_962] } };
      }
      if (ref.artifact_id === location.artifact_id) {
        return {
          content_hash: { value: "valid-localization-geometry" },
          payload: {
            property_context_ref: { artifact_id: "other-property", artifact_type: "LU_PROPERTY_CONTEXT" },
            coordinates: [6_777_906, 481_963],
          },
        };
      }
      return undefined;
    });
    const provider = await providerWithQueryStub();

    await expect(provider.query({
      property_ref: property,
      location_ref: location,
      layers: [{ name: "water", version_hash: "human-readable-label" }],
    })).rejects.toThrow("REJECT_LOCALIZATION_GEOMETRY_WRONG_PROPERTY");
    expect(cas.put).not.toHaveBeenCalled();
  });

  it("denies a missing or tampered localization geometry before evidence creation", async () => {
    const provider = await providerWithQueryStub();
    await expect(provider.query({
      property_ref: property,
      location_ref: { ...location, artifact_id: "missing-localization" },
      layers: [{ name: "water", version_hash: "human-readable-label" }],
    })).rejects.toThrow("REJECT_LOCALIZATION_GEOMETRY_LOOKUP");

    cas.resolve.mockImplementation(async (ref: { artifact_id: string }) => {
      if (ref.artifact_id === property.artifact_id) {
        return { payload: { coordinates: [6_777_905, 481_962] } };
      }
      return {
        content_hash: { value: "tampered" },
        payload: { property_context_ref: property, coordinates: [6_777_906, 481_963] },
      };
    });
    await expect(provider.query({
      property_ref: property,
      location_ref: location,
      layers: [{ name: "water", version_hash: "human-readable-label" }],
    })).rejects.toThrow("REJECT_LOCALIZATION_GEOMETRY_TAMPERED");
    expect(cas.put).not.toHaveBeenCalled();
  });
});
