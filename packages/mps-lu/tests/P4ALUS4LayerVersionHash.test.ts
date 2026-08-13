import { describe, expect, it } from "vitest";

import {
  assertLayerVersionHash,
  buildSpatialEvidenceIdentityPayload,
  computeSpatialEvidenceHash,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type { SpatialEvidencePayload } from "../src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";
import { SPATIAL_LAYER_REGISTRY } from "../../spatial-provider-postgis/src/SpatialLayerRegistry";
import {
  EBH_LAYER_VERSION_HASH,
  WATER_LAYER_VERSION_HASH,
} from "./fixtures/spatialLayerHashes";

/**
 * ✅ P4A-LU-S4 — LAYER VERSION HASH GREEN PROOF.
 *
 *   Invariant under test:
 *     A layer label/version string is not evidence identity. The spatial evidence identity must
 *     bind the authoritative version_hash of the governed source/dataset artifact that
 *     materialized the PostGIS layer.
 *
 *   Scope: registry contract + identity barrier only. No S5 canonical geometry work, no runtime
 *   entrypoint proof, no capability-registry wiring.
 */
describe("P4A-LU-S4 — layer version_hash identity binding", () => {
  function payload(versionHash = WATER_LAYER_VERSION_HASH): SpatialEvidencePayload {
    return {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-s4", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 500,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-s4", artifact_type: "PROPERTY" },
      layer_ref: {
        layer_id: "water",
        version_hash: versionHash,
        layer_version: "v1",
      },
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
        dataset_version: versionHash,
        retrieved_at: "2026-08-13T08:00:00.000Z",
      },
      query_context: {
        query_id: "corr-s4",
        query_type: "SPATIAL_DWITHIN",
        parameters: {
          property_ref: { artifact_id: "prop-s4", artifact_type: "PROPERTY" },
          search_distance_meters: 500,
        },
      },
    };
  }

  it("SpatialLayerRegistry carries SHA-256 version_hash for every admitted LU layer", () => {
    for (const [name, binding] of Object.entries(SPATIAL_LAYER_REGISTRY)) {
      expect(
        () => assertLayerVersionHash(binding.version_hash),
        `S4: layer '${name}' must bind a governed dataset-artifact hash, not a label.`,
      ).not.toThrow();
    }
  });

  it("identity payload binds version_hash and does not bind the human layer_version label", () => {
    const identity = buildSpatialEvidenceIdentityPayload(payload()) as {
      layer_ref: Record<string, unknown>;
    };

    expect(identity.layer_ref.version_hash).toBe(WATER_LAYER_VERSION_HASH);
    expect(
      identity.layer_ref,
      "S4: layer_version is human-readable provenance only. If it reaches the identity payload, " +
        "a label like 'v1' can masquerade as dataset identity.",
    ).not.toHaveProperty("layer_version");
  });

  it("same query + same layer_id + different version_hash produces different identity", () => {
    expect(
      computeSpatialEvidenceHash(payload(WATER_LAYER_VERSION_HASH)),
      "S4: two materialized dataset versions must not collapse to one spatial evidence identity.",
    ).not.toBe(computeSpatialEvidenceHash(payload(EBH_LAYER_VERSION_HASH)));
  });

  it("changing only the human label does not change identity", () => {
    const base = payload();
    const relabeled = {
      ...base,
      layer_ref: { ...base.layer_ref, layer_version: "v2" },
    };

    expect(computeSpatialEvidenceHash(relabeled)).toBe(computeSpatialEvidenceHash(base));
  });

  it("label-only layer versions fail closed before identity construction", () => {
    for (const bad of ["v1", "2026-08-13", "env.sgu_well", "sha256:" + "a".repeat(64), ""]) {
      const badPayload = {
        ...payload(),
        layer_ref: { ...payload().layer_ref, version_hash: bad },
      };

      expect(
        () => computeSpatialEvidenceHash(badPayload),
        `S4: '${bad}' is not a governed dataset artifact SHA-256 hash.`,
      ).toThrow(/REJECT_LAYER_VERSION_HASH/);
    }
  });

  it("missing version_hash fails closed before identity construction", () => {
    const { version_hash: _versionHash, ...labelOnly } = payload().layer_ref;
    const badPayload = {
      ...payload(),
      layer_ref: labelOnly,
    } as unknown as SpatialEvidencePayload;

    expect(() => computeSpatialEvidenceHash(badPayload)).toThrow(
      /REJECT_LAYER_VERSION_HASH/,
    );
  });
});
