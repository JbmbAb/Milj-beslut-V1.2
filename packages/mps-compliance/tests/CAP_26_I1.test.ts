import { describe, it, expect } from "vitest";
import { CAP_26_I1 } from "../src/validators/CAP_26_I1";
import type { ArtifactContract } from "../src/artifacts/ArtifactContract";
import type { ValidationContext } from "../src/conformance/ValidationContext";

/**
 * CAP-26-I1-EVIDENCE-TYPE-01 — CAP_26_I1 previously returned evidence as bare artifact-id
 * strings (string[]), not the readonly ValidationEvidence[] ValidationResult.evidence requires.
 * This went uncaught until PROD-LU-ADMISSION-01B/02 pulled this file into
 * P3LuVerdictTypeBoundary.test.ts's strictly type-checked LU import closure.
 */

function contextWith(artifacts: readonly ArtifactContract[]): ValidationContext {
  const byKey = new Map(artifacts.map((a) => [`${a.artifact_type}:${a.artifact_id}`, a]));
  return {
    artifacts,
    resolve: (ref) => byKey.get(`${ref.artifact_type}:${ref.artifact_id}`),
  };
}

const capabilityArtifact: ArtifactContract = {
  artifact_id: "cap-1",
  artifact_type: "CAPABILITY_DEFINITION",
  content_hash: { algorithm: "sha256", value: "h-cap" },
  references: [],
};

describe("CAP_26_I1", () => {
  it("passes and emits real ValidationEvidence (not bare strings) when a capability artifact is present", () => {
    const result = CAP_26_I1.validate(contextWith([capabilityArtifact]));

    expect(result.passed).toBe(true);
    expect(result.evidence).toHaveLength(1);
    const [evidence] = result.evidence;
    expect(typeof evidence).toBe("object");
    expect(evidence.evidence_id).toBeTruthy();
    expect(evidence.rule_id).toBe("CAP-26-I1");
    expect(evidence.artifact_ref).toEqual({
      artifact_id: capabilityArtifact.artifact_id,
      artifact_type: capabilityArtifact.artifact_type,
    });
    expect(typeof evidence.observation).toBe("string");
  });

  it("passes trivially with no artifacts and empty evidence", () => {
    const result = CAP_26_I1.validate(contextWith([]));
    expect(result.passed).toBe(true);
    expect(result.evidence).toEqual([]);
  });

  it("fails when artifacts exist but none are capability-like", () => {
    const unrelated: ArtifactContract = {
      artifact_id: "unrelated-1",
      artifact_type: "execution_manifest",
      content_hash: { algorithm: "sha256", value: "h-unrelated" },
      references: [],
    };
    const result = CAP_26_I1.validate(contextWith([unrelated]));
    expect(result.passed).toBe(false);
    expect(result.evidence).toEqual([]);
  });
});
