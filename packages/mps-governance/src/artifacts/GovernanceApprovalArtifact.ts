import { CanonicalArtifact } from "@miljobeslut/mps-evolution/src/core/types.js";
import { ContentReference, ActorReference, GovernanceDecision } from "../types.js";

export interface GovernanceApprovalArtifact extends CanonicalArtifact {
    artifact_type: "GOVERNANCE_APPROVAL";
    promotion_decision_ref: ContentReference;
    evidence_refs: ContentReference[];
    governance_policy_ref: ContentReference;
    governance_result: GovernanceDecision;
    decided_by: ActorReference;
    rationale: string;
}
