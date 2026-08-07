/**
 * C-05 Restart Replay — fresh process ⇒ same artifact hash
 */
import { describe, expect, it } from "vitest";
import {
  MaterializationPipeline,
  type VerifiedEvidenceSet,
} from "../src/index.js";

const evidence: VerifiedEvidenceSet = {
  source_artifact_hashes: ["sha256:eeeeeeee", "sha256:ffffffff"],
  jurisdiction_level: "COUNTY",
  decision_type: "WASTEWATER",
  county_code: "17",
  verified_attributes: {
    count: 42,
    domain: "wastewater",
  },
};

describe("RestartReplay", () => {
  it("Evidence + rule + materialization + canonical versions → same hash after restart", () => {
    const runA = new MaterializationPipeline().materialize(evidence);

    // Restart: new pipeline instance, empty CAS
    const runB = new MaterializationPipeline().materialize(evidence);

    expect(runA.artifact.impact_id).toBe(runB.artifact.impact_id);
    expect(runA.canonical_payload).toBe(runB.canonical_payload);
    expect(runA.evidence_set_hash).toBe(runB.evidence_set_hash);
    expect(runA.status).toBe("CREATED");
    expect(runB.status).toBe("CREATED");
  });
});
