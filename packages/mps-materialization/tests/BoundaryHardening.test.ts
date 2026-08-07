/**
 * Boundary hardening tests (not features):
 * 1. Materialization adversarial
 * 2. Cross-process determinism
 * 3. Version boundary
 * + MIMER-MAT-I01 authority
 */
import { describe, expect, it } from "vitest";
import type { EvidenceSetArtifact } from "../../mps-decision-governance/src/index.js";
import {
  assertMaterializationAuthority,
  CasMaterializationRepository,
  createMaterializationRegistry,
  DECISION_IMPACT_V1,
  defaultMaterializationRegistry,
  LineageValidator,
  MaterializationAuthorityError,
  MaterializationContractError,
  MaterializationPipeline,
  type VerifiedEvidenceSet,
} from "../src/index.js";

const evidenceA: VerifiedEvidenceSet = {
  source_artifact_hashes: ["sha256:adv11111", "sha256:adv22222"],
  jurisdiction_level: "MUNICIPALITY",
  decision_type: "WASTEWATER",
  municipality_code: "2062",
  verified_attributes: { count: 5, domain: "wastewater" },
};

describe("Materialization adversarial", () => {
  it("tampered Evidence A under stolen EvidenceSet hash X → LINEAGE_VERIFICATION_FAILED", () => {
    const honest = new MaterializationPipeline().materialize(evidenceA);
    expect(honest.status).toBe("CREATED");

    // Steal hash X but mutate identity documents (tampered evidence).
    const forged: EvidenceSetArtifact = {
      evidence_set_hash: honest.evidence_set_hash,
      identity: {
        documents: [{ document_hash: "sha256:TAMPERED" }],
        schema_version: 1,
        lineage_sequence: 1,
        lineage_scope: {
          jurisdiction_level: "MUNICIPALITY",
          decision_type: "WASTEWATER",
        },
      },
      metadata: {
        created_at: "1970-01-01T00:00:00.000Z",
        materialization_version: "mat-1",
        generated_by: "adversary",
      },
    };

    const lineage = new LineageValidator();
    expect(() => lineage.commitAfterClosure(forged)).toThrow(
      MaterializationContractError,
    );
    try {
      lineage.commitAfterClosure(forged);
    } catch (e) {
      expect((e as MaterializationContractError).code).toBe(
        "LINEAGE_VERIFICATION_FAILED",
      );
    }

    // Honest rematerialize of modified attributes yields a *different* authority, not X.
    const modified = new MaterializationPipeline().materialize({
      ...evidenceA,
      verified_attributes: { count: 999, domain: "wastewater" },
    });
    expect(modified.artifact.impact_id).not.toBe(honest.artifact.impact_id);
    expect(modified.evidence_set_hash).not.toBe(honest.evidence_set_hash);
  });
});

describe("Cross-process determinism", () => {
  it("Container A and Container B produce identical artifact_hash", () => {
    // Simulate isolated containers: independent pipelines + CAS + lineage.
    const containerA = new MaterializationPipeline({
      repository: new CasMaterializationRepository(),
      lineage: new LineageValidator(),
    });
    const containerB = new MaterializationPipeline({
      repository: new CasMaterializationRepository(),
      lineage: new LineageValidator(),
    });

    const a = containerA.materialize(evidenceA);
    const b = containerB.materialize(evidenceA);

    expect(a.artifact.impact_id).toBe(b.artifact.impact_id);
    expect(a.canonical_payload).toBe(b.canonical_payload);
    expect(a.evidence_set_hash).toBe(b.evidence_set_hash);
  });
});

describe("Version boundary", () => {
  it("same evidence + rules, different materialization_version → hash A ≠ hash B", () => {
    const v1 = new MaterializationPipeline({
      materialization_version: "mat-1",
      rule_version: "rules-1",
    }).materialize(evidenceA);

    const v2 = new MaterializationPipeline({
      materialization_version: "mat-2",
      rule_version: "rules-1",
    }).materialize(evidenceA);

    expect(v1.artifact.impact_id).not.toBe(v2.artifact.impact_id);
    expect(v1.canonical_payload).not.toBe(v2.canonical_payload);
  });
});

describe("MIMER-MAT-I01 Materialization Authority Boundary", () => {
  it("forbids ChatAgent / LLM / Retrieval from creating Decision Truth", () => {
    for (const actor of ["ChatAgent", "LLM", "Retrieval", "UI", "Runtime"]) {
      expect(() => assertMaterializationAuthority(actor)).toThrow(
        MaterializationAuthorityError,
      );
    }
  });

  it("allows MaterializationPipeline; CAS rejects forbidden actor on put", () => {
    expect(() =>
      assertMaterializationAuthority("MaterializationPipeline"),
    ).not.toThrow();

    const repo = new CasMaterializationRepository();
    const built = new MaterializationPipeline().materialize(evidenceA);
    expect(() =>
      repo.putImpact(built.artifact, "ChatAgent"),
    ).toThrow(MaterializationAuthorityError);
  });
});

describe("Materialization Registry", () => {
  it("binds decision_impact_v1 to canonicalizer/rules/materializer", () => {
    const reg = defaultMaterializationRegistry.resolve("decision_impact_v1");
    expect(reg).toEqual(DECISION_IMPACT_V1);
    expect(reg.canonicalizer).toBe("dg-canonical-1");
    expect(reg.rules).toBe("rules-1");
    expect(reg.materializer).toBe("mat-1");
  });

  it("rejects duplicate artifact_type registrations", () => {
    expect(() =>
      createMaterializationRegistry([DECISION_IMPACT_V1, DECISION_IMPACT_V1]),
    ).toThrow(MaterializationContractError);
  });
});
