/**
 * C-03 Lineage Closure — EvidenceSet not authoritative before closure
 */
import { describe, expect, it } from "vitest";
import {
  EvidenceSetLineageError,
  type EvidenceSetArtifact,
} from "../../mps-decision-governance/src/index.js";
import {
  CasMaterializationRepository,
  LineageValidator,
  MaterializationContractError,
  MaterializationPipeline,
  type VerifiedEvidenceSet,
} from "../src/index.js";

const evidence: VerifiedEvidenceSet = {
  source_artifact_hashes: ["sha256:cccccccc"],
  jurisdiction_level: "MUNICIPALITY",
  decision_type: "WASTEWATER",
  municipality_code: "2062",
  verified_attributes: { count: 1 },
};

describe("LineageClosure", () => {
  it("failed lineage prevents CAS authority", () => {
    const repo = new CasMaterializationRepository();
    const rejecting = {
      resolve() {
        return undefined;
      },
      append(_a: EvidenceSetArtifact) {
        throw new EvidenceSetLineageError("LINEAGE_NOT_CLOSED", "simulated");
      },
    };

    const pipe = new MaterializationPipeline({
      repository: repo,
      lineage: new LineageValidator(rejecting),
    });

    expect(() => pipe.materialize(evidence)).toThrow(MaterializationContractError);

    const ok = new MaterializationPipeline().materialize(evidence);
    expect(repo.getImpact(ok.artifact.impact_id)).toBeUndefined();
    expect(repo.getEvidenceSet(ok.evidence_set_hash)).toBeUndefined();
  });

  it("order: assertClosed then commit (happy path)", () => {
    const result = new MaterializationPipeline().materialize(evidence);
    expect(result.status).toBe("CREATED");
    expect(result.evidence_set_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
