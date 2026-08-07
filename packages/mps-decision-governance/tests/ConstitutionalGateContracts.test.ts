/**
 * Constitutional gate contracts (frozen before Package 22.5 / larger epochs).
 *
 * Not new features — executable proofs of constitutional correctness:
 *   C-02 Canonical Domain Separation
 *   C-03 Lineage Closure Before Authority
 *   C-04 Retrieval Boundary
 *   C-05 Materialization Replay
 *
 * @see ADR-MPS-CONSTITUTIONAL-INVARIANTS.md
 */
import { describe, expect, it } from "vitest";
import {
  buildEvidenceSetIdentityPayload,
  hashVersionedCanonicalPayload,
} from "../src/CanonicalDecisionImpactHash";
import { InMemoryDecisionKnowledgeRepository } from "../src/DecisionKnowledgeRepository";
import {
  assertAnalyticalRetrievalContract,
  createDecisionRetrievalPlan,
  DecisionRetrievalContractError,
  type DecisionRetrievalPlan,
} from "../src/DecisionRetrievalContract";
import { DeterministicMaterializationPipeline } from "../src/MaterializationPipeline";
import type { CanonicalMaterializationSource } from "../src/MaterializationContract";
import type { EvidenceSetArtifact } from "../src/EvidenceSetArtifact";
import {
  EvidenceSetLineageError,
  type EvidenceSetLineageResolver,
} from "../src/validation/validateEvidenceSetLineage";
import type { EvidenceSetIdentity } from "../src/EvidenceSetArtifact";

const payloadIdentity: EvidenceSetIdentity = {
  documents: [{ document_hash: "payload-A" }],
  schema_version: 1,
  lineage_sequence: 1,
  lineage_scope: {
    jurisdiction_level: "MUNICIPALITY",
    decision_type: "WASTEWATER",
  },
};

const source: CanonicalMaterializationSource = {
  source_document_hashes: ["raw-1"],
  jurisdiction_level: "MUNICIPALITY",
  decision_type: "WASTEWATER",
  municipality_code: "2062",
  derivation_version: "ww-v1",
  schema_version: 1,
  decision_facts: { outcome: "CONDITIONED" },
  indicator: {
    code: "WW-01",
    description: "cases",
    value: 1,
    unit: "pcs",
    confidence: "HIGH",
    derivation: "COUNT",
  },
};

describe("Constitutional gate contracts (pre-22.5)", () => {
  it("C-02 Canonical Domain Separation: version X hash ≠ version Y hash for same payload", () => {
    const payload = buildEvidenceSetIdentityPayload(payloadIdentity);
    const underV1 = hashVersionedCanonicalPayload(payload, "dg-canonical-1");
    const underV2 = hashVersionedCanonicalPayload(payload, "dg-canonical-2");
    expect(underV1).not.toBe(underV2);
  });

  it("C-03 Lineage Closure: EvidenceSet SHALL NOT become authoritative before lineage succeeds", () => {
    const repo = new InMemoryDecisionKnowledgeRepository();
    const rejectingLineage: EvidenceSetLineageResolver & {
      append(artifact: EvidenceSetArtifact): void;
    } = {
      resolve() {
        return undefined;
      },
      append() {
        throw new EvidenceSetLineageError(
          "LINEAGE_NOT_CLOSED",
          "Lineage closure failed (simulated)",
        );
      },
    };

    const pipeline = new DeterministicMaterializationPipeline({
      repository: repo,
      lineageStore: rejectingLineage,
    });

    expect(() => pipeline.materialize(source)).toThrow(EvidenceSetLineageError);

    // No authoritative EvidenceSet / DecisionImpact after failed lineage.
    // Impact id is deterministic — probe that CAS is empty for any known outcome.
    const probe = new DeterministicMaterializationPipeline({
      repository: new InMemoryDecisionKnowledgeRepository(),
    });
    const wouldBe = probe.materialize(source);
    expect(repo.getDecisionImpact(wouldBe.impact_id)).toBeUndefined();
    if (wouldBe.status === "CREATED") {
      expect(repo.getEvidenceSet(wouldBe.evidence_set_hash)).toBeUndefined();
    }
  });

  it("C-04 Retrieval Boundary: forbid DocumentChunk / Raw as initial analytical target", () => {
    // Allowed path
    const allowed = createDecisionRetrievalPlan({
      intent: "analytical query",
    });
    expect(allowed.initial_stage).toBe("DECISION_IMPACT");

    // Forbidden: GENERAL QUERY → Raw Evidence / DocumentChunk
    for (const illegalInitial of ["RAW_EVIDENCE", "DocumentChunk", "DOCUMENT_CHUNK"] as const) {
      const illegal = {
        contract_version: "1",
        query: { intent: "bypass" },
        initial_stage: illegalInitial,
        expand_to_evidence_sets: false,
        expand_to_raw_evidence: true,
        max_decision_impacts: 5,
        max_evidence_sets: 5,
        max_raw_documents: 100,
      } as unknown as DecisionRetrievalPlan;

      expect(() => assertAnalyticalRetrievalContract(illegal)).toThrow(
        DecisionRetrievalContractError,
      );
      try {
        assertAnalyticalRetrievalContract(illegal);
      } catch (e) {
        expect((e as DecisionRetrievalContractError).code).toBe(
          "MIMER_SCALE_I01_VIOLATION",
        );
      }
    }
  });

  it("C-05 Materialization Replay: restart materializer → identical artifact hash", () => {
    // Run A
    const repoA = new InMemoryDecisionKnowledgeRepository();
    const a = new DeterministicMaterializationPipeline({
      repository: repoA,
    }).materialize(source);

    // Restart (fresh process simulation: new pipeline + empty CAS)
    const repoB = new InMemoryDecisionKnowledgeRepository();
    const b = new DeterministicMaterializationPipeline({
      repository: repoB,
    }).materialize(source);

    expect(a.impact_id).toBe(b.impact_id);
    expect(a.canonical_payload).toBe(b.canonical_payload);
    expect(a.status).toBe("CREATED");
    expect(b.status).toBe("CREATED");
  });
});
