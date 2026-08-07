/**
 * DecisionKnowledgeRepository — CAS lookup only.
 * artifact_hash → DecisionImpactArtifact / EvidenceSetArtifact
 *
 * No AI. No ranking. No semantics. Just content-addressed retrieval.
 */

import type { DecisionImpactArtifact } from "./DecisionImpactIdentity";
import type { EvidenceSetArtifact } from "./EvidenceSetArtifact";

export interface DecisionKnowledgeRepository {
  getDecisionImpact(impact_id: string): DecisionImpactArtifact | undefined;
  getEvidenceSet(evidence_set_hash: string): EvidenceSetArtifact | undefined;
  putDecisionImpact(artifact: DecisionImpactArtifact): void;
  putEvidenceSet(artifact: EvidenceSetArtifact): void;
}

export class InMemoryDecisionKnowledgeRepository
  implements DecisionKnowledgeRepository
{
  private readonly impacts = new Map<string, DecisionImpactArtifact>();
  private readonly evidenceSets = new Map<string, EvidenceSetArtifact>();

  getDecisionImpact(impact_id: string): DecisionImpactArtifact | undefined {
    return this.impacts.get(impact_id);
  }

  getEvidenceSet(evidence_set_hash: string): EvidenceSetArtifact | undefined {
    return this.evidenceSets.get(evidence_set_hash);
  }

  putDecisionImpact(artifact: DecisionImpactArtifact): void {
    // CAS dedup: same identity hash overwrites with identical content only.
    const existing = this.impacts.get(artifact.impact_id);
    if (existing && existing.impact_id === artifact.impact_id) {
      this.impacts.set(artifact.impact_id, artifact);
      return;
    }
    this.impacts.set(artifact.impact_id, artifact);
  }

  putEvidenceSet(artifact: EvidenceSetArtifact): void {
    this.evidenceSets.set(artifact.evidence_set_hash, artifact);
  }
}
