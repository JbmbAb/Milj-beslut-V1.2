import { describe, it, expect } from "vitest";
import { LURuleEngine } from "../src/rules/LURuleEngine";
import type { SpatialEvidenceArtifact } from "../src/artifacts/SpatialEvidenceArtifact";
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

function evaluate(evidenceList: SpatialEvidenceArtifact[]) {
  return new LURuleEngine().evaluate({ spatial_evidence: evidenceList, document_evidence: [] });
}

describe("LURuleEngine -- LU-BREADTH-01 recovery", () => {
  it("natura2000 evidence produces LU-NATURA2000-001, HIGH", () => {
    const findings = evaluate([evidence("ev-natura2000", "natura2000")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      finding_id: "finding-natura2000-ev-natura2000",
      rule_id: "LU-NATURA2000-001",
      rule_version: "1.0",
      risk_level: "HIGH",
    });
  });

  it("water_protection_area evidence produces LU-WATERPROTECTION-001, HIGH", () => {
    const findings = evaluate([evidence("ev-waterprotection", "water_protection_area")]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      finding_id: "finding-waterprotection-ev-waterprotection",
      rule_id: "LU-WATERPROTECTION-001",
      rule_version: "1.0",
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
