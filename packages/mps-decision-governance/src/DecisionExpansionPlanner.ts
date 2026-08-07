/**
 * DecisionExpansionPlanner — scalability lever for Decision Knowledge Plane.
 *
 * Analytical query → bounded DecisionImpact set → optional EvidenceSet → optional docs
 * Avoids "10 000 chunks → LLM" in favour of "17 impacts → 2 sets → 38 docs → LLM".
 *
 * Enforces DecisionRetrievalContract / MIMER-SCALE-I01.
 */

import {
  assertAnalyticalRetrievalContract,
  createDecisionRetrievalPlan,
  type AnalyticalQuery,
  type DecisionRetrievalPlan,
  type DecisionRetrievalResult,
  type RetrievalStage,
} from "./DecisionRetrievalContract";
import type { DecisionKnowledgeResolver } from "./DecisionKnowledgeResolver";

export type ExpansionPlannerInput = {
  readonly query: AnalyticalQuery;
  /** Candidate DecisionImpact ids already selected by an index/filter (not raw chunks). */
  readonly candidate_impact_ids: readonly string[];
  readonly expand_to_evidence_sets?: boolean;
  readonly expand_to_raw_evidence?: boolean;
  readonly max_decision_impacts?: number;
  readonly max_evidence_sets?: number;
  readonly max_raw_documents?: number;
};

export interface DecisionExpansionPlanner {
  plan(input: ExpansionPlannerInput): DecisionRetrievalPlan;
  execute(
    input: ExpansionPlannerInput,
    resolver: DecisionKnowledgeResolver,
  ): DecisionRetrievalResult;
}

export class DefaultDecisionExpansionPlanner implements DecisionExpansionPlanner {
  plan(input: ExpansionPlannerInput): DecisionRetrievalPlan {
    return createDecisionRetrievalPlan(input.query, {
      expand_to_evidence_sets: input.expand_to_evidence_sets,
      expand_to_raw_evidence: input.expand_to_raw_evidence,
      max_decision_impacts: input.max_decision_impacts,
      max_evidence_sets: input.max_evidence_sets,
      max_raw_documents: input.max_raw_documents,
    });
  }

  execute(
    input: ExpansionPlannerInput,
    resolver: DecisionKnowledgeResolver,
  ): DecisionRetrievalResult {
    const plan = this.plan(input);
    assertAnalyticalRetrievalContract(plan);

    const decision_impact_ids = input.candidate_impact_ids.slice(
      0,
      plan.max_decision_impacts,
    );

    const stages_used: RetrievalStage[] = ["DECISION_IMPACT"];
    const evidence_set_hashes: string[] = [];
    const document_hashes: string[] = [];

    if (plan.expand_to_evidence_sets) {
      stages_used.push("EVIDENCE_SET");
      for (const id of decision_impact_ids) {
        for (const set of resolver.resolveEvidenceSets(id)) {
          if (!evidence_set_hashes.includes(set.evidence_set_hash)) {
            evidence_set_hashes.push(set.evidence_set_hash);
          }
          if (evidence_set_hashes.length >= plan.max_evidence_sets) break;
        }
        if (evidence_set_hashes.length >= plan.max_evidence_sets) break;
      }
    }

    if (plan.expand_to_raw_evidence) {
      stages_used.push("RAW_EVIDENCE");
      for (const id of decision_impact_ids) {
        for (const doc of resolver.resolveDocuments(id)) {
          if (!document_hashes.includes(doc.document_hash)) {
            document_hashes.push(doc.document_hash);
          }
          if (document_hashes.length >= plan.max_raw_documents) break;
        }
        if (document_hashes.length >= plan.max_raw_documents) break;
      }
    }

    return Object.freeze({
      plan,
      decision_impact_ids: Object.freeze([...decision_impact_ids]),
      evidence_set_hashes: Object.freeze(evidence_set_hashes.slice(0, plan.max_evidence_sets)),
      document_hashes: Object.freeze(document_hashes.slice(0, plan.max_raw_documents)),
      stages_used: Object.freeze(stages_used),
    });
  }
}
