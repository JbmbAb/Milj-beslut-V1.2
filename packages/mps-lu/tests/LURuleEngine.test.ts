import { describe, it, expect } from "vitest";
import { LURuleEngine } from "../src/rules/LURuleEngine";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
import type { SpatialLayerUnavailable } from "../src/services/SpatialQueryContract";
import { SPATIAL_STACK_V1 } from "../src/artifacts/SpatialEngineFingerprint";

/**
 * SHARED-CHECKOUT-WIP-RECOVERY-01, cluster #2 (LU-BREADTH-01).
 *
 * No dedicated focused test existed for LURuleEngine before this recovery -- the two new rules
 * (natura2000, water_protection_area) were previously only indirectly exercised by
 * P4ALU05RealRuntimeEntrypoint.test.ts (a broader integration test, currently one of the tracked
 * pre-existing failures being fixed on a separate branch). This file exists to give the recovered
 * rules a real, isolated proof, and to lock in that the three pre-existing layer rules are
 * unchanged by the recovery.
 */
function evidence(artifactId: string, layer: string): SpatialEvidenceArtifact {
  const versionHash = "b".repeat(64);
  const payload = {
    result_semantics: {
      kind: "EXISTENCE_WITHIN_DISTANCE" as const,
      query: { subject_ref: { artifact_id: "prop-rule-engine-test", artifact_type: "PROPERTY" }, srid: 3006, distance_meters: 100 },
      result: { exists: true, match_count_observed: 1, max_features_per_layer: 50 },
    },
    property_ref: { artifact_id: "prop-rule-engine-test", artifact_type: "PROPERTY" },
    geometry: null,
    srid: 3006,
    operation: { algorithm: "spatial.dwithin_existence", engine: "PostGIS", engine_fingerprint: SPATIAL_STACK_V1 },
    layer_ref: { layer_id: layer, version_hash: versionHash, layer_version: "v1" },
    source_metadata: { provider: "SGU", dataset: layer, dataset_version: versionHash, retrieved_at: "2026-08-24T00:00:00.000Z" },
    query_context: { query_id: `q-${artifactId}`, query_type: "SPATIAL_DWITHIN", parameters: {} },
  };
  return {
    artifact_id: artifactId,
    artifact_type: "SPATIAL_EVIDENCE",
    content_hash: { algorithm: "sha256", value: `hash-${artifactId}` },
    references: [{ artifact_id: "prop-rule-engine-test", artifact_type: "PROPERTY" }],
    payload,
  } as unknown as SpatialEvidenceArtifact;
}

function evaluate(
  evidenceList: SpatialEvidenceArtifact[],
  unavailableLayers: readonly SpatialLayerUnavailable[] = [],
) {
  return new LURuleEngine().evaluate({
    spatial_evidence: evidenceList,
    document_evidence: [],
    unavailable_layers: unavailableLayers,
  });
}

describe("LURuleEngine -- LU-BREADTH-01 recovery", () => {
  it("natura2000 evidence produces LU-NATURA2000-001, HIGH", () => {
    const findings = evaluate([evidence("ev-natura2000", "natura2000")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      finding_id: "finding-natura2000-ev-natura2000",
      rule_id: "LU-NATURA2000-001",
      // SEM-1 (W2): bumped from "1.0". Deliberate, documented expectation change -- the rule's
      // contract now admits a NOT_CHECKED outcome, so its version changed even though this
      // particular finding's HIGH grade did not. See docs/architecture/audits/LU-W2-SEM1-NOT-CHECKED-V1.md.
      rule_version: "2.0",
      risk_level: "HIGH",
    });
  });

  it("water_protection_area evidence produces LU-WATERPROTECTION-001, HIGH", () => {
    const findings = evaluate([evidence("ev-waterprotection", "water_protection_area")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      finding_id: "finding-waterprotection-ev-waterprotection",
      rule_id: "LU-WATERPROTECTION-001",
      // SEM-1 (W2): bumped from "1.0" -- see the natura2000 case above for why.
      rule_version: "2.0",
      risk_level: "HIGH",
    });
  });

  it("evidence with result_semantics.result.exists = false produces no finding, for the new rules too", () => {
    const noHit = evidence("ev-no-hit", "natura2000");
    (noHit.payload as { result_semantics: { result: { exists: boolean } } }).result_semantics.result.exists = false;
    expect(evaluate([noHit])).toHaveLength(0);
  });

  it.each([
    ["water", "LU-WATER-001", "MEDIUM"],
    ["ebh", "LU-EBH-001", "HIGH"],
    ["protected_area", "LU-PROTECTED-001", "MEDIUM"],
  ] as const)("pre-existing layer rule %s -> %s / %s is unchanged by the recovery", (layer, ruleId, riskLevel) => {
    const findings = evaluate([evidence(`ev-${layer}`, layer)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule_id: ruleId, risk_level: riskLevel });
  });

  it("multiple simultaneous layer hits each produce their own finding", () => {
    const findings = evaluate([
      evidence("ev-water-multi", "water"),
      evidence("ev-natura2000-multi", "natura2000"),
      evidence("ev-waterprotection-multi", "water_protection_area"),
    ]);
    expect(findings.map((f) => f.rule_id).sort()).toEqual(["LU-NATURA2000-001", "LU-WATER-001", "LU-WATERPROTECTION-001"].sort());
  });
});

describe("LURuleEngine -- SEM-1/OD-03 (W2) NOT_CHECKED emission", () => {
  it("an unavailable layer with a known governed rule produces a NOT_CHECKED finding, not silence", () => {
    const findings = evaluate([], [{ dataset: "water", reason: "Error: connection reset" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule_id: "LU-WATER-001",
      rule_version: "2.0",
      risk_level: "NOT_CHECKED",
      evidence_refs: [],
    });
  });

  it.each([
    ["water", "LU-WATER-001"],
    ["ebh", "LU-EBH-001"],
    ["protected_area", "LU-PROTECTED-001"],
    ["natura2000", "LU-NATURA2000-001"],
    ["water_protection_area", "LU-WATERPROTECTION-001"],
  ] as const)("unavailable layer %s maps to %s's NOT_CHECKED finding", (dataset, ruleId) => {
    const findings = evaluate([], [{ dataset, reason: "technical failure" }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule_id).toBe(ruleId);
    expect(findings[0].risk_level).toBe("NOT_CHECKED");
  });

  it("an unavailable layer with no known governed rule produces no finding", () => {
    // LU-DOC-BESLUT-001 is document-based, not layer-based: a spatial layer failure can never
    // qualify it, and there is no other rule for an unrecognised dataset name either.
    const findings = evaluate([], [{ dataset: "not_a_real_layer", reason: "technical failure" }]);
    expect(findings).toHaveLength(0);
  });

  it("SEM-1's actual point: one layer's unavailability does not suppress the other layers' real findings", () => {
    const findings = evaluate(
      [evidence("ev-ebh-ok", "ebh"), evidence("ev-protected-ok", "protected_area")],
      [{ dataset: "water", reason: "Error: connection reset" }],
    );
    expect(findings).toHaveLength(3);
    const byRule = new Map(findings.map((f) => [f.rule_id, f]));
    expect(byRule.get("LU-EBH-001")).toMatchObject({ risk_level: "HIGH" });
    expect(byRule.get("LU-PROTECTED-001")).toMatchObject({ risk_level: "MEDIUM" });
    expect(byRule.get("LU-WATER-001")).toMatchObject({ risk_level: "NOT_CHECKED" });
  });

  it("a checked-and-absent layer (exists:false) still produces no finding -- unchanged v1 semantics, not NOT_CHECKED", () => {
    const noHit = evidence("ev-checked-absent", "water");
    (noHit.payload as { result_semantics: { result: { exists: boolean } } }).result_semantics.result.exists = false;
    const findings = evaluate([noHit]);
    expect(findings).toHaveLength(0);
  });

  it("no unavailable_layers argument at all (legacy callers) behaves exactly as before this unit", () => {
    expect(new LURuleEngine().evaluate({ spatial_evidence: [], document_evidence: [] })).toHaveLength(0);
  });
});
