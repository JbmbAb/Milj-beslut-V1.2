import { describe, it, expect } from "vitest";

import {
  SPATIAL_STACK_V1,
  SPATIAL_STACK_COMPONENTS,
  assertExactEngineFingerprint,
  isExactEngineFingerprint,
  type SpatialEngineFingerprint,
} from "../src/artifacts/SpatialEngineFingerprint";
import {
  buildSpatialEvidenceIdentityPayload,
  computeSpatialEvidenceHash,
} from "../src/artifacts/SpatialEvidenceIdentity";
import type { SpatialEvidencePayload } from "../src/artifacts/SpatialEvidenceArtifact";

/**
 * ✅ P4A-LU-S1 / S2 / S3 — ENGINE FINGERPRINT GREEN PROOF.
 *
 *   Invariant under test:
 *     TV-S1 §5.2 — substituting an engine produces a NEW evidence identity, not an equal one.
 *
 *   Three registered defects, closed together because they are one defect from three sides:
 *     S1  `postgis: "3.x"` — the literal wildcard SV-I03 forbids
 *     S3  the full stack (GEOS, PROJ, GDAL) absent, and the two providers disagreeing
 *     S2  the artifact CARRIED a fingerprint the identity did not BIND
 *
 *   S2 is the one that mattered most and was hardest to see: a wildcard is visibly wrong,
 *   whereas an unbound fingerprint looks correct while silently collapsing distinct executions
 *   into a single identity.
 *
 *   Out of scope and untouched: S4 (version_hash), S5 (sv-canonical-1), P4A-LU-01/03/05.
 *
 *   @see docs/architecture/P4A-LU-GATE-CONTRACT-2026-08-11.md §3, §5
 */
describe("P4A-LU-S2/S3 — engine fingerprint identity binding (GREEN PROOF)", () => {
  function payload(fingerprint: SpatialEngineFingerprint = SPATIAL_STACK_V1): SpatialEvidencePayload {
    return {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-s23", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 500,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-s23", artifact_type: "PROPERTY" },
      layer_ref: {
        layer_id: "water",
        version_hash: "2b4b514f8b18a1a614d9aeac75c32eff8c52a3864c54770be112fd88fa263ddc",
        layer_version: "v1",
      },
      srid: 3006,
      operation: {
        algorithm: "spatial.dwithin_existence",
        engine: "PostGIS",
        engine_fingerprint: fingerprint,
      },
      geometry: null,
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
          property_ref: { artifact_id: "prop-s23", artifact_type: "PROPERTY" },
          search_distance_meters: 500,
        },
      },
    };
  }

  // ------------------------------------------------------------ SPATIAL_STACK_V1

  it("SPATIAL_STACK_V1 pins the full TV-4.3 verified baseline with exact versions", () => {
    expect(SPATIAL_STACK_V1).toEqual({
      postgis: "3.4.3",
      geos: "3.9.0",
      proj: "7.2.1",
      gdal: "3.2.2",
    });
    expect(Object.isFrozen(SPATIAL_STACK_V1)).toBe(true);
    expect(SPATIAL_STACK_COMPONENTS).toEqual(["postgis", "geos", "proj", "gdal"]);
  });

  // -------------------------------------------------------------------- S2 core

  it("substituting the engine stack produces a DIFFERENT identity", () => {
    const upgraded: SpatialEngineFingerprint = { ...SPATIAL_STACK_V1, postgis: "3.5.0" };

    expect(
      computeSpatialEvidenceHash(payload()),
      "S2/TV-S1 §5.2: a PostGIS upgrade must yield new evidence identities. Equal hashes here " +
        "would mean two artifacts computed on different stacks are indistinguishable.",
    ).not.toBe(computeSpatialEvidenceHash(payload(upgraded)));
  });

  it("every stack component participates — none is decorative", () => {
    const base = computeSpatialEvidenceHash(payload());

    for (const component of SPATIAL_STACK_COMPONENTS) {
      const changed = computeSpatialEvidenceHash(
        payload({ ...SPATIAL_STACK_V1, [component]: "9.9.9" }),
      );
      expect(
        changed,
        `S3: '${component}' can change the spatial result, so it must change the identity. ` +
          "A component carried but not bound is worse than one that is absent — it looks bound.",
      ).not.toBe(base);
    }
  });

  it("the identity payload binds the fingerprint in fixed component order", () => {
    const identity = buildSpatialEvidenceIdentityPayload(payload()) as {
      operation: { engine_fingerprint: Record<string, string> };
    };

    expect(identity.operation).toHaveProperty("engine_fingerprint");
    expect(
      Object.keys(identity.operation.engine_fingerprint),
      "Key order is fixed by SPATIAL_STACK_COMPONENTS so a producer spelling the fingerprint " +
        "in another order cannot mint a second identity for the same stack.",
    ).toEqual(["postgis", "geos", "proj", "gdal"]);
  });

  it("re-spelling the same stack in another key order yields the SAME identity", () => {
    const reordered = {
      gdal: "3.2.2",
      proj: "7.2.1",
      geos: "3.9.0",
      postgis: "3.4.3",
    } as SpatialEngineFingerprint;

    expect(computeSpatialEvidenceHash(payload(reordered))).toBe(
      computeSpatialEvidenceHash(payload()),
    );
  });

  // -------------------------------------------------------------- S1 — wildcards

  it("a wildcard version is REJECTED and cannot obtain an identity", () => {
    const wildcard = { ...SPATIAL_STACK_V1, postgis: "3.x" } as SpatialEngineFingerprint;

    expect(() => assertExactEngineFingerprint(wildcard)).toThrow(/non-exact version/);
    expect(
      () => computeSpatialEvidenceHash(payload(wildcard)),
      "S1: '3.x' does not identify an execution, so evidence pinned to it can never be " +
        "replayed against a known stack. Enforced at identity time — a check further " +
        "downstream would arrive after the artifact is already hashable.",
    ).toThrow(/REJECT_ENGINE_FINGERPRINT/);
  });

  it("ranges and partial versions are rejected too", () => {
    for (const bad of ["^3.4.3", "~3.4.3", ">=3.4", "3.4", "3", "latest", ""]) {
      expect(
        isExactEngineFingerprint({ ...SPATIAL_STACK_V1, geos: bad }),
        `S1: '${bad}' is not an exact version.`,
      ).toBe(false);
    }
  });

  // ------------------------------------------------------------- S3 — completeness

  it("an incomplete stack is REJECTED, naming what is missing", () => {
    const { gdal, ...withoutGdal } = SPATIAL_STACK_V1;

    expect(() =>
      assertExactEngineFingerprint(withoutGdal as Record<string, string>),
    ).toThrow(/missing gdal/);

    const onlyPostgis = { postgis: "3.4.3" };
    expect(() => assertExactEngineFingerprint(onlyPostgis)).toThrow(/geos, proj, gdal/);
  });

  it("a missing fingerprint is REJECTED — evidence may not omit the stack that computed it", () => {
    expect(() => assertExactEngineFingerprint(undefined)).toThrow(/mandatory/);
  });

  it("a non-engine key is REJECTED rather than ignored", () => {
    // The production provider carried `srid` inside the fingerprint, conflating a query
    // parameter with the execution stack. Ignoring unknown keys would let that reappear.
    const withSrid = { ...SPATIAL_STACK_V1, srid: "3006" };

    expect(() => assertExactEngineFingerprint(withSrid)).toThrow(/unknown component\(s\) srid/);
  });
});
