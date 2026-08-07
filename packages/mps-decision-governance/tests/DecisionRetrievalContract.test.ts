/**
 * Decision Knowledge Retrieval Contract — MIMER-SCALE-I01 executable
 */
import { describe, expect, it } from "vitest";
import { hashDecisionImpactIdentity } from "../src/CanonicalDecisionImpactHash";
import { hashEvidenceSetIdentity } from "../src/CanonicalDecisionImpactHash";
import { DefaultDecisionExpansionPlanner } from "../src/DecisionExpansionPlanner";
import { InMemoryDecisionKnowledgeRepository } from "../src/DecisionKnowledgeRepository";
import { DefaultDecisionKnowledgeResolver } from "../src/DecisionKnowledgeResolver";
import {
  assertAnalyticalRetrievalContract,
  createDecisionRetrievalPlan,
  DecisionRetrievalContractError,
  type DecisionRetrievalPlan,
} from "../src/DecisionRetrievalContract";
import type { DecisionImpactArtifact } from "../src/DecisionImpactIdentity";
import type { EvidenceSetArtifact } from "../src/EvidenceSetArtifact";

describe("DecisionRetrievalContract / MIMER-SCALE-I01", () => {
  it("analytical plan always starts at DECISION_IMPACT", () => {
    const plan = createDecisionRetrievalPlan({
      intent: "Visa utvecklingen av avloppsärenden i Värmland",
      county_code: "17",
      decision_type: "WASTEWATER",
    });
    expect(plan.initial_stage).toBe("DECISION_IMPACT");
    expect(() => assertAnalyticalRetrievalContract(plan)).not.toThrow();
  });

  it("forbids Raw Evidence as initial stage", () => {
    const illegal = {
      contract_version: "1",
      query: { intent: "raw dump" },
      initial_stage: "RAW_EVIDENCE",
      expand_to_evidence_sets: false,
      expand_to_raw_evidence: true,
      max_decision_impacts: 10,
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
  });

  it("forbids skipping EvidenceSet when expanding to Raw Evidence", () => {
    expect(() =>
      createDecisionRetrievalPlan(
        { intent: "skip" },
        { expand_to_evidence_sets: false, expand_to_raw_evidence: true },
      ),
    ).toThrow(/EvidenceSet/);
  });

  it("expansion planner: DecisionImpact → EvidenceSet → docs (bounded, not 10k chunks)", () => {
    const repo = new InMemoryDecisionKnowledgeRepository();

    const evidenceIdentity = {
      documents: [
        { document_hash: "doc-1" },
        { document_hash: "doc-2" },
        { document_hash: "doc-3" },
      ],
      schema_version: 1,
      lineage_sequence: 1,
      lineage_scope: {
        jurisdiction_level: "COUNTY" as const,
        decision_type: "WASTEWATER" as const,
      },
    };
    const evidence: EvidenceSetArtifact = {
      evidence_set_hash: hashEvidenceSetIdentity(evidenceIdentity),
      identity: evidenceIdentity,
      metadata: {
        created_at: "2026-08-07T12:00:00.000Z",
        materialization_version: "v1",
        generated_by: "test",
      },
    };
    repo.putEvidenceSet(evidence);

    const impactIdentity = {
      jurisdiction_level: "COUNTY" as const,
      decision_type: "WASTEWATER" as const,
      county_code: "17",
      evidence_set_hashes: [evidence.evidence_set_hash],
      indicators: [
        {
          code: "WW-COUNT",
          description: "Wastewater cases",
          value: 42,
          unit: "pcs",
          confidence: "HIGH" as const,
          derivation: "COUNT" as const,
        },
      ],
      schema_version: 1,
      derivation_version: "ww-v1",
    };
    const impact: DecisionImpactArtifact = {
      impact_id: hashDecisionImpactIdentity(impactIdentity),
      identity: impactIdentity,
      metadata: {
        created_at: "2026-08-07T12:00:00.000Z",
        materialization_version: "v1",
        generated_by: "test",
      },
    };
    repo.putDecisionImpact(impact);

    const resolver = new DefaultDecisionKnowledgeResolver(repo);
    const planner = new DefaultDecisionExpansionPlanner();
    const result = planner.execute(
      {
        query: {
          intent: "Visa utvecklingen av avloppsärenden i Värmland",
          county_code: "17",
          decision_type: "WASTEWATER",
        },
        candidate_impact_ids: [impact.impact_id],
        expand_to_evidence_sets: true,
        expand_to_raw_evidence: true,
        max_decision_impacts: 17,
        max_evidence_sets: 2,
        max_raw_documents: 38,
      },
      resolver,
    );

    expect(result.stages_used).toEqual([
      "DECISION_IMPACT",
      "EVIDENCE_SET",
      "RAW_EVIDENCE",
    ]);
    expect(result.decision_impact_ids).toHaveLength(1);
    expect(result.evidence_set_hashes).toEqual([evidence.evidence_set_hash]);
    expect(result.document_hashes).toEqual(["doc-1", "doc-2", "doc-3"]);
    // Cost shape: distilled facts first — not raw-chunk fanout.
    expect(result.document_hashes.length).toBeLessThan(38);
  });
});
