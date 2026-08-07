/**
 * MaterializationRepository — CAS put/get only (no ranking, no AI).
 * Writes are gated by MIMER-MAT-I01 (Materialization Authority Boundary).
 */

import type {
  DecisionImpactArtifact,
  EvidenceSetArtifact,
} from "../../mps-decision-governance/src/index.js";
import {
  InMemoryDecisionKnowledgeRepository,
  type DecisionKnowledgeRepository,
} from "../../mps-decision-governance/src/index.js";
import { assertMaterializationAuthority } from "./MaterializationAuthority.js";

export interface MaterializationRepository {
  getImpact(impact_id: string): DecisionImpactArtifact | undefined;
  getEvidenceSet(evidence_set_hash: string): EvidenceSetArtifact | undefined;
  putImpact(artifact: DecisionImpactArtifact, actor?: string): void;
  putEvidenceSet(artifact: EvidenceSetArtifact, actor?: string): void;
}

export class CasMaterializationRepository implements MaterializationRepository {
  constructor(
    private readonly store: DecisionKnowledgeRepository = new InMemoryDecisionKnowledgeRepository(),
  ) {}

  getImpact(impact_id: string): DecisionImpactArtifact | undefined {
    return this.store.getDecisionImpact(impact_id);
  }

  getEvidenceSet(evidence_set_hash: string): EvidenceSetArtifact | undefined {
    return this.store.getEvidenceSet(evidence_set_hash);
  }

  putImpact(
    artifact: DecisionImpactArtifact,
    actor: string = "MaterializationPipeline",
  ): void {
    assertMaterializationAuthority(actor);
    this.store.putDecisionImpact(artifact);
  }

  putEvidenceSet(
    artifact: EvidenceSetArtifact,
    actor: string = "MaterializationPipeline",
  ): void {
    assertMaterializationAuthority(actor);
    this.store.putEvidenceSet(artifact);
  }
}
