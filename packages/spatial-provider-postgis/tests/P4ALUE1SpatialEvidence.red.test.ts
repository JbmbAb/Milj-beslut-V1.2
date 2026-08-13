import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildSpatialEvidenceIdentityPayload,
  computeSpatialEvidenceHash,
} from "../../mps-lu/src/artifacts/SpatialEvidenceIdentity";
import type { SpatialEvidencePayload } from "../../mps-lu/src/artifacts/SpatialEvidenceArtifact";
import { SPATIAL_LAYER_REGISTRY } from "../src/SpatialLayerRegistry";

/**
 * 🔴 P4A-LU-E1 — SPATIAL EVIDENCE RED BASELINE. THESE TESTS ARE EXPECTED TO FAIL.
 *
 *   This file is the measurement point for P4A-LU-02 / -06 and for the newly registered S6.
 *   It asserts the FROZEN contract, not current behaviour. Every failure below is a defect
 *   already registered in the gate contract — none of them is a surprise, and none of them
 *   should be "fixed" by weakening an assertion here.
 *
 *   Naming follows the existing red-proof convention (A1AuthorityBypass.red.test.ts.historical):
 *   rename to `.historical` only once the corresponding gate is PROVEN.
 *
 *   ⚠️ DO NOT rewire the provider to make these pass. The gate contract's implementation order
 *   puts identity, canonicalization and result semantics BEFORE provider wiring, precisely so
 *   that evidence produced in the meantime does not become a migration item.
 *
 *   @see docs/architecture/P4A-LU-E1-SPATIAL-EVIDENCE-SEMANTICS-2026-08-13.md
 *   @see docs/architecture/P4A-LU-GATE-CONTRACT-2026-08-11.md
 */
describe("🔴 P4A-LU-E1 — spatial evidence identity & truthfulness (RED BASELINE)", () => {
  const PROVIDER_SRC = readFileSync(
    join(__dirname, "..", "src", "SpatialProviderPostGIS.ts"),
    "utf8",
  );

  /**
   * S6 (2026-08-13) made `result_semantics` mandatory and `geometry` null under the admitted v1
   * semantics, so this helper now declares existence semantics and carries no geometry.
   *
   * R5/R6 below still need a geometry to reason about. They therefore force a reserved,
   * NOT-YET-ADMITTED `FEATURE_GEOMETRY` kind. That is deliberate: sv-canonical-1's coordinate
   * rules are currently DORMANT — no admitted semantics produces geometry — and these
   * assertions exist to stop them being forgotten before FEATURE_GEOMETRY is admitted.
   */
  function payload(overrides: Partial<SpatialEvidencePayload> = {}): SpatialEvidencePayload {
    return {
      result_semantics: {
        kind: "EXISTENCE_WITHIN_DISTANCE",
        query: {
          subject_ref: { artifact_id: "prop-e1", artifact_type: "PROPERTY" },
          srid: 3006,
          distance_meters: 500,
        },
        result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
      },
      property_ref: { artifact_id: "prop-e1", artifact_type: "PROPERTY" },
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
          property_ref: { artifact_id: "prop-e1", artifact_type: "PROPERTY" },
          search_distance_meters: 500,
        },
      },
      ...overrides,
    } as SpatialEvidencePayload;
  }

  // ------------------------------------------------- S2 — fingerprint outside identity

  it("R1 — substituting the engine stack MUST produce a different evidence identity", () => {
    const onStackA = payload();
    const onStackB = payload({
      operation: {
        ...payload().operation,
        engine_fingerprint: { postgis: "3.5.0", geos: "3.12.1", proj: "9.3.1", gdal: "3.8.0" },
      },
    } as Partial<SpatialEvidencePayload>);

    expect(
      computeSpatialEvidenceHash(onStackA),
      "TV-S1 §5.2: substituting an engine produces a NEW evidence identity, not an equal one. " +
        "Equal hashes here mean two artifacts computed on different stacks are indistinguishable.",
    ).not.toBe(computeSpatialEvidenceHash(onStackB));
  });

  it("R2 — the identity payload MUST bind the engine fingerprint", () => {
    const identity = buildSpatialEvidenceIdentityPayload(payload()) as {
      operation?: Record<string, unknown>;
    };

    expect(
      identity.operation,
      "S2: the artifact carries engine_fingerprint but the identity domain binds only " +
        "algorithm + engine. The artifact says more than its identity commits to.",
    ).toHaveProperty("engine_fingerprint");
  });

  // ------------------------------------------------- S1 / S3 — wildcard + incomplete stack

  it("R3 — the provider MUST use the frozen stack constant, not an inline fingerprint", () => {
    // Originally a source-text check for wildcards and the four components inside an inline
    // literal. S2/S3 (2026-08-13) extracted the fingerprint into the frozen SPATIAL_STACK_V1,
    // which made the text heuristic obsolete — there is no longer a literal to inspect.
    // Exactness and completeness are now proven behaviourally, at the identity barrier, in
    // packages/mps-lu/tests/P4ALUS2S3EngineFingerprint.test.ts. What remains worth guarding
    // here is that the provider does not drift back to an inline literal.
    expect(
      /engine_fingerprint:\s*SPATIAL_STACK_V1/.test(PROVIDER_SRC),
      "S1/S3: the provider must reference the single frozen stack. Two providers with two " +
        "inline literals meant evidence identity depended on which one ran.",
    ).toBe(true);

    expect(
      /engine_fingerprint:\s*\{/.test(PROVIDER_SRC),
      "S1/S3: no inline engine_fingerprint object may reach the evidence path. The old " +
        '`postgis: "3.x"` bug is now documented in comments, so the proof must guard the ' +
        "structure that would reintroduce the bug, not the spelling of historical notes.",
    ).toBe(false);
  });

  // ------------------------------------------------- S4 — layer version binding

  it("R4 — every registry layer MUST carry a version_hash", () => {
    for (const [name, binding] of Object.entries(SPATIAL_LAYER_REGISTRY)) {
      expect(
        binding,
        `S4: layer '${name}' has no version_hash in the registry, so the only available layer ` +
          `version is the one the CALLER asserts. Evidence must bind a registry-verified ` +
          `dataset version, not a claim supplied with the request.`,
      ).toHaveProperty("version_hash");
    }
  });

  // ------------------------------------------------- S5 — sv-canonical-1 is name-only

  /** Reserved kind, NOT admitted by policy — see the helper comment. Forced so R5/R6 can exist. */
  const asFeatureGeometry = {
    kind: "FEATURE_GEOMETRY",
    query: {
      subject_ref: { artifact_id: "prop-e1", artifact_type: "PROPERTY" },
      srid: 3006,
      distance_meters: 500,
    },
    result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
  } as unknown as SpatialEvidencePayload["result_semantics"];

  it.skip(
    "R5 — sv-canonical-1 MUST normalize ring orientation before hashing (DORMANT until FEATURE_GEOMETRY is admitted)",
    () => {
    const ccw = payload({
      result_semantics: asFeatureGeometry,
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
    } as Partial<SpatialEvidencePayload>);
    const cw = payload({
      result_semantics: asFeatureGeometry,
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]],
      },
    } as Partial<SpatialEvidencePayload>);

    expect(
      computeSpatialEvidenceHash(ccw),
      "S5: sv-canonical-1 requires normalized ring orientation. The same polygon wound the " +
        "other way is the same geometry and must not yield a second identity.",
    ).toBe(computeSpatialEvidenceHash(cw));
    },
  );

  it.skip(
    "R6 — sv-canonical-1 MUST round to the fixed decimal grid BEFORE serialization (DORMANT until FEATURE_GEOMETRY is admitted)",
    () => {
    const exact = payload({
      result_semantics: asFeatureGeometry,
      geometry: {
        type: "Polygon",
        coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
      },
    } as Partial<SpatialEvidencePayload>);
    const subGrid = payload({
      result_semantics: asFeatureGeometry,
      geometry: {
        type: "Polygon",
        coordinates: [
          [[0, 0], [10.0000000001, 0], [10.0000000001, 10], [0, 10], [0, 0]],
        ],
      },
    } as Partial<SpatialEvidencePayload>);

    expect(
      computeSpatialEvidenceHash(exact),
      "S5: a difference below the canonical decimal grid is not a semantic difference. " +
        "canonicalizeStrict is RFC8785 JSON canonicalization (C-01) — it is NOT sv-canonical-1, " +
        "which the hash prefix nevertheless claims.",
    ).toBe(computeSpatialEvidenceHash(subGrid));
    },
  );

  // ------------------------------------------------- S6 — geometry truthfulness

  it("R7 — the provider MUST NOT fabricate geometry (S6, rewritten after the owner freeze)", () => {
    // Originally asserted that the query SHOULD select geometry. The owner froze
    // EXISTENCE_WITHIN_DISTANCE as v1 semantics on 2026-08-13, so retrieving no geometry is now
    // CORRECT — and the invariant becomes the opposite one: nothing may invent a geometry to
    // fill the gap. Rewritten because the contract was decided, not to make a failure go away.
    const fabricatesEnvelope = /easting\s*[-+]\s*0\.001|northing\s*[-+]\s*0\.001/.test(
      PROVIDER_SRC,
    );

    expect(
      fabricatesEnvelope,
      "S6: the executed query is `SELECT 1 AS hit` and retrieves no geometry. The provider used " +
        "to fabricate a ±0.001 m envelope around the QUERY POINT — in SWEREF99 TM a 2 mm square " +
        "unrelated to anything found — and bind it as the evidence geometry.",
    ).toBe(false);
  });

  // ------------------------------------------------- B1b — effective parameters

  it("R8 — effective executed parameters MUST be bound into identity", () => {
    // Originally expected the limit under `parameters`. S6 (2026-08-13) placed it inside
    // `result_semantics.result`, because it shapes the observable RESULT rather than being an
    // external budget knob. The requirement — the executed limit reaches identity — is
    // unchanged; only its location was decided after this assertion was written.
    const identity = buildSpatialEvidenceIdentityPayload(payload()) as {
      result_semantics?: { result?: Record<string, unknown> };
    };

    expect(
      identity.result_semantics?.result,
      "B1b: max_features_per_layer is executed as `LIMIT $4` and changes the result set, but " +
        "identity binds only property_ref + search_distance_meters. Two runs under different " +
        "feature budgets can share an identity while having executed differently. " +
        "(B1a — search distance — is NOT a defect: over-budget requests fail closed rather " +
        "than being silently clipped.)",
    ).toHaveProperty("max_features_per_layer");
  });
});
