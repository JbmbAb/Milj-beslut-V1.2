import { CanonicalArtifact } from "@miljobeslut/mps-evolution/src/core/types.js";
import { ContentReference, ActorReference, GovernanceDecision } from "../types.js";

export interface GovernanceReviewArtifact extends CanonicalArtifact {
    artifact_type: "GOVERNANCE_REVIEW";
    subject_ref: ContentReference;
    evidence_refs: ContentReference[];
    reviewer: ActorReference;
    decision: GovernanceDecision;
    comments: string;
}
