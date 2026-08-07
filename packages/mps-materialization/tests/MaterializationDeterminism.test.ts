/**
 * MAT-I01 – MAT-I04 on the reconciled Materialization Boundary (Commit H.3).
 * One contract: injected dependencies + materialize(evidenceSet).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  hashEvidenceSetIdentity,
  InMemoryEvidenceSetLineageStore,
  type EvidenceSetArtifact,
  type EvidenceSetIdentity,
} from "../../mps-decision-governance/src/index.js";
import {
  assertNoAiInMaterializationCore,
  CasMaterializationRepository,
  createSetEvidenceResolver,
  decisionGovernanceIdentityProvider,
  LineageValidator,
  MaterializationContractError,
  MaterializationPipeline,
  type VerifiedEvidenceSet,
} from "../src/index.js";

const evidence: VerifiedEvidenceSet = {
  source_artifact_hashes: ["sha256:doc-1", "sha256:doc-2"],
  jurisdiction_level: "COUNTY",
  decision_type: "ENVIRONMENTAL_PERMIT",
  county_code: "17",
  verified_attributes: { count: 2, domain: "environmental" },
};

function evidenceArtifact(
  lineage_sequence: number,
  previous_evidence_set_hash?: string,
): EvidenceSetArtifact {
  const identity: EvidenceSetIdentity = {
    documents: [{ document_hash: `doc-seq-${lineage_sequence}` }],
    schema_version: 1,
    lineage_sequence,
    ...(previous_evidence_set_hash !== undefined ? { previous_evidence_set_hash } : {}),
    lineage_scope: {
      jurisdiction_level: "COUNTY",
      decision_type: "ENVIRONMENTAL_PERMIT",
    },
  };

  return {
    evidence_set_hash: hashEvidenceSetIdentity(identity),
    identity,
    metadata: {
      created_at: "1970-01-01T00:00:00.000Z",
      materialization_version: "mat-1",
      generated_by: "test",
    },
  };
}

describe("MAT-I01: Authority Boundary", () => {
  it("evidence that cannot be resolved never reaches materialization", () => {
    const pipeline = new MaterializationPipeline({
      evidenceResolver: createSetEvidenceResolver(["sha256:doc-1"]),
    });

    expect(() => pipeline.materialize(evidence)).toThrowError("EVIDENCE_NOT_RESOLVABLE");
  });

  it("lineage regression closes the door before authority is granted", () => {
    const store = new InMemoryEvidenceSetLineageStore();
    const parent = evidenceArtifact(10);
    store.append(parent);

    const regressed = evidenceArtifact(5, parent.evidence_set_hash);
    const lineage = new LineageValidator(store);

    expect(() => lineage.commitAfterClosure(regressed)).toThrowError(
      MaterializationContractError,
    );
    try {
      lineage.commitAfterClosure(regressed);
    } catch (e) {
      expect((e as MaterializationContractError).code).toBe("LINEAGE_NOT_CLOSED");
      expect((e as Error).message).toContain("lineage_sequence must strictly increase");
    }
  });
});

describe("MAT-I02: Deterministic Materialization", () => {
  it("same inputs always yield an identical artifact hash", () => {
    const runA = new MaterializationPipeline({
      repository: new CasMaterializationRepository(),
      lineageValidator: new LineageValidator(),
    }).materialize(evidence);

    const runB = new MaterializationPipeline({
      repository: new CasMaterializationRepository(),
      lineageValidator: new LineageValidator(),
    }).materialize(evidence);

    expect(runA.artifact.impact_id).toBe(runB.artifact.impact_id);
    expect(runA.evidence_set_hash).toBe(runB.evidence_set_hash);
  });

  it("the pipeline calculates no identity of its own and infers nothing", () => {
    const core = ["MaterializationPipeline.ts", "DecisionFactsBuilder.ts", "DecisionImpactBuilder.ts"];

    for (const file of core) {
      const source = readFileSync(join(__dirname, "../src", file), "utf8");
      expect(source).not.toContain("createHash");
      expect(source).not.toContain("sha256");
      expect(() => assertNoAiInMaterializationCore(source, file)).not.toThrow();
    }
  });
});

describe("MAT-I03: Restart Determinism", () => {
  it("a fresh process reproduces identical outputs", () => {
    const before = new MaterializationPipeline().materialize(evidence);

    // Restart: new pipeline, new CAS, new lineage store.
    const after = new MaterializationPipeline().materialize(evidence);

    expect(after.artifact.impact_id).toBe(before.artifact.impact_id);
    expect(after.canonical_payload).toBe(before.canonical_payload);
    expect(after.evidence_set_hash).toBe(before.evidence_set_hash);
  });
});

describe("MAT-I04: Provenance Isolation", () => {
  it("changing metadata or provenance leaves the identity hash untouched", () => {
    const result = new MaterializationPipeline().materialize(evidence);

    const reProvenanced = {
      ...result.artifact,
      metadata: {
        created_at: "2026-08-07T13:00:00.000Z",
        materialization_version: result.versions.materialization_version,
        generated_by: "some-other-runner",
      },
    };

    expect(decisionGovernanceIdentityProvider.hashDecisionImpact(reProvenanced.identity)).toBe(
      result.artifact.impact_id,
    );
  });
});
