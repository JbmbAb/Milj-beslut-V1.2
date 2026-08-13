import { describe, it, expect } from "vitest";

import {
  SPATIAL_RESULT_SEMANTICS_POLICY_V1,
  assertGeometryMatchesSemantics,
  isAdmittedSemanticsKind,
  type SpatialResultSemantics,
} from "../src/artifacts/SpatialResultSemantics";
import {
  buildSpatialEvidenceIdentityPayload,
  computeSpatialEvidenceHash,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type { SpatialEvidencePayload } from "../src/artifacts/SpatialEvidenceArtifact";

/**
 * ✅ P4A-LU-S6 — RESULT SEMANTICS GREEN PROOF (contract form + carrying).
 *
 *   OWNER FREEZE 2026-08-13: EXISTENCE_WITHIN_DISTANCE is the v1 semantics, and
 *   SpatialEvidence identity SHALL bind the declared result semantics.
 *
 *   The four assertions below the divider were the S6-CARRYING red baseline. They are kept
 *   LIVE rather than archived as `.historical` (the A1/SR1 convention) because they are the
 *   standing guard against a provider re-fabricating geometry or a semantics change slipping
 *   past identity. An archived proof cannot catch a regression.
 *
 *   Still OPEN and deliberately untouched by this unit: S5 (sv-canonical-1), S1/S3 (engine
 *   fingerprint), S4 (version_hash), P4A-LU-01/03/05.
 *
 *   @see docs/architecture/P4A-LU-E1-SPATIAL-EVIDENCE-SEMANTICS-2026-08-13.md
 */
describe("P4A-LU-S6 — spatial result semantics contract", () => {
  const existence: SpatialResultSemantics = {
    kind: "EXISTENCE_WITHIN_DISTANCE",
    query: {
      subject_ref: { artifact_id: "prop-s6", artifact_type: "PROPERTY" },
      srid: 3006,
      distance_meters: 500,
    },
    result: { exists: true, match_count_observed: 3, max_features_per_layer: 50 },
  };

  function payload(semantics?: SpatialResultSemantics): SpatialEvidencePayload {
    return {
      property_ref: { artifact_id: "prop-s6", artifact_type: "PROPERTY" },
      srid: 3006,
      geometry: null,
      operation: {
        algorithm: "spatial.dwithin_existence",
        engine: "PostGIS",
        engine_fingerprint: { postgis: "3.4.3", geos: "3.9.0", proj: "7.2.1", gdal: "3.2.2" },
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
        retrieved_at: "2026-08-13T08:00:00.000Z",
      },
      query_context: {
        query_id: "corr-water",
        query_type: "SPATIAL_DWITHIN",
        parameters: {
          property_ref: { artifact_id: "prop-s6", artifact_type: "PROPERTY" },
          search_distance_meters: 500,
        },
      },
      ...(semantics ? { result_semantics: semantics } : {}),
    } as unknown as SpatialEvidencePayload;
  }

  // ------------------------------------------------------------------ GREEN

  it("v1 admits existence only — naming a kind is not admitting it", () => {
    expect(SPATIAL_RESULT_SEMANTICS_POLICY_V1.admitted_kinds).toEqual([
      "EXISTENCE_WITHIN_DISTANCE",
    ]);
    expect(isAdmittedSemanticsKind("EXISTENCE_WITHIN_DISTANCE")).toBe(true);
    expect(
      isAdmittedSemanticsKind("FEATURE_GEOMETRY"),
      "S6: FEATURE_GEOMETRY is named so identity can distinguish it, not so it can be produced. " +
        "It becomes admissible when a provider can honestly populate it.",
    ).toBe(false);
  });

  it("EXISTENCE_WITHIN_DISTANCE carries no geometry — the truthfulness invariant", () => {
    expect(() => assertGeometryMatchesSemantics(existence, null)).not.toThrow();

    expect(
      () =>
        assertGeometryMatchesSemantics(existence, {
          type: "Polygon",
          coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]],
        }),
      "S6: the executed query retrieves no geometry, so any non-null geometry on an existence " +
        "artifact is fabricated by definition. This is the exact ±0.001 m envelope defect.",
    ).toThrow(/REJECT_SPATIAL_SEMANTICS/);
  });

  it("the result-shaping limit lives inside the semantics, not in a budget block", () => {
    expect(
      existence.result.max_features_per_layer,
      "B1b: max_features_per_layer is executed as LIMIT and changes the result set. Holding it " +
        "here means binding the semantics also binds it.",
    ).toBe(50);
  });

  // ------------------------------------------------------- CARRYING (was RED)

  it("SpatialEvidencePayload carries the declared result semantics", () => {
    const p = payload(existence) as unknown as Record<string, unknown>;

    expect(
      p,
      "S6: an artifact that does not declare what spatial truth it carries leaves the reader to " +
        "infer it — which is how a 2 mm envelope came to be read as a spatial result. The field " +
        "is REQUIRED on the payload, so omission is now a compile error; this asserts the " +
        "runtime shape as well.",
    ).toHaveProperty("result_semantics");
  });

  it("identity binds the declared result semantics", () => {
    const identity = buildSpatialEvidenceIdentityPayload(payload(existence)) as Record<
      string,
      unknown
    >;

    expect(
      identity,
      "FROZEN PRINCIPLE: SpatialEvidence identity SHALL bind the declared result semantics.",
    ).toHaveProperty("result_semantics");
  });

  it("differing semantics yield differing identities when all else coincides", () => {
    const asExistence = payload(existence);
    const asBuffer = payload({
      ...existence,
      kind: "SEARCH_BUFFER",
    } as unknown as SpatialResultSemantics);

    expect(
      computeSpatialEvidenceHash(asExistence),
      "S6: EXISTENCE_WITHIN_DISTANCE ≠ SEARCH_BUFFER even when every other input is identical. " +
        "Equal hashes here mean a future change of semantics would silently reinterpret evidence " +
        "already produced instead of creating new evidence.",
    ).not.toBe(computeSpatialEvidenceHash(asBuffer));
  });

  it("the limit that shaped the result reaches identity", () => {
    const small = payload({
      ...existence,
      result: { ...existence.result, max_features_per_layer: 10 },
    });
    const large = payload({
      ...existence,
      result: { ...existence.result, max_features_per_layer: 50 },
    });

    expect(
      computeSpatialEvidenceHash(small),
      "B1b: two runs executed under different feature limits must not share an identity.",
    ).not.toBe(computeSpatialEvidenceHash(large));
  });
});
