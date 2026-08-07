/**
 * DecisionKnowledgeResolver — graph traversal only.
 * DecisionImpact → EvidenceSet → Document references
 *
 * Not LLM. Not prompting. Just traversal.
 */

import type { DecisionImpactArtifact } from "./DecisionImpactIdentity";
import type {
  EvidenceDocumentReference,
  EvidenceSetArtifact,
} from "./EvidenceSetArtifact";
import type { DecisionKnowledgeRepository } from "./DecisionKnowledgeRepository";

export type DecisionKnowledgeGraph = {
  readonly decision_impact: DecisionImpactArtifact;
  readonly evidence_sets: readonly EvidenceSetArtifact[];
  readonly documents: readonly EvidenceDocumentReference[];
};

export interface DecisionKnowledgeResolver {
  resolveImpact(impact_id: string): DecisionImpactArtifact | undefined;
  resolveEvidenceSets(impact_id: string): readonly EvidenceSetArtifact[];
  resolveDocuments(impact_id: string): readonly EvidenceDocumentReference[];
  resolveGraph(impact_id: string): DecisionKnowledgeGraph | undefined;
}

export class DefaultDecisionKnowledgeResolver implements DecisionKnowledgeResolver {
  constructor(private readonly repo: DecisionKnowledgeRepository) {}

  resolveImpact(impact_id: string): DecisionImpactArtifact | undefined {
    return this.repo.getDecisionImpact(impact_id);
  }

  resolveEvidenceSets(impact_id: string): readonly EvidenceSetArtifact[] {
    const impact = this.repo.getDecisionImpact(impact_id);
    if (!impact) return [];
    const sets: EvidenceSetArtifact[] = [];
    for (const hash of impact.identity.evidence_set_hashes) {
      const set = this.repo.getEvidenceSet(hash);
      if (set) sets.push(set);
    }
    return Object.freeze(sets);
  }

  resolveDocuments(impact_id: string): readonly EvidenceDocumentReference[] {
    const byHash = new Map<string, EvidenceDocumentReference>();
    for (const set of this.resolveEvidenceSets(impact_id)) {
      for (const doc of set.identity.documents) {
        byHash.set(doc.document_hash, doc);
      }
    }
    return Object.freeze(
      [...byHash.values()].sort((a, b) =>
        a.document_hash.localeCompare(b.document_hash),
      ),
    );
  }

  resolveGraph(impact_id: string): DecisionKnowledgeGraph | undefined {
    const decision_impact = this.resolveImpact(impact_id);
    if (!decision_impact) return undefined;
    return Object.freeze({
      decision_impact,
      evidence_sets: this.resolveEvidenceSets(impact_id),
      documents: this.resolveDocuments(impact_id),
    });
  }
}
