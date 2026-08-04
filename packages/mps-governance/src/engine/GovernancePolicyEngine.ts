import { ActorReference, ContentReference, GovernanceDecision } from "../types.js";
import { CanonicalArtifact } from "../../../mps-evolution/src/core/types.js";
import { GovernanceReviewArtifact } from "../artifacts/GovernanceReviewArtifact.js";
import { GovernancePolicyArtifact } from "../artifacts/GovernancePolicyArtifact.js";
import { GovernanceApprovalArtifact } from "../artifacts/GovernanceApprovalArtifact.js";
import { assertContentReferenceMatches } from "../../../mps-evolution/src/core/assertContentReferenceMatches.js";

// Note: In a real environment, this might be imported from mps-evolution
interface PromotionDecisionArtifact extends CanonicalArtifact {
    artifact_type: "PROMOTION_DECISION";
    candidate_ref: ContentReference;
    evaluation_ref: ContentReference;
    approved: boolean;
    reason: string;
}

export class GovernancePolicyEngine {
    constructor() {}

    /**
     * Determines the final approval and returns a constructed but unsigned GovernanceApprovalArtifact.
     * Signing and hashing happens in the Repository/CAS layer.
     */
    evaluate(
        promotionRef: ContentReference,
        promotionArtifact: PromotionDecisionArtifact,
        policyRef: ContentReference,
        policyArtifact: GovernancePolicyArtifact | undefined | null,
        reviewsRefs: ContentReference[],
        reviewsArtifacts: GovernanceReviewArtifact[],
        decidedBy: ActorReference,
        rationale: string
    ): Omit<GovernanceApprovalArtifact, 'content_hash' | 'schema_version' | 'signature'> {
        
        // 1. Verify identities (simulate what the Engine must do before trusting refs)
        assertContentReferenceMatches(promotionRef, promotionArtifact);
        if (!policyArtifact) {
            throw new Error("GOVERNANCE_POLICY_MISSING: Policy artifact could not be resolved.");
        }
        assertContentReferenceMatches(policyRef, policyArtifact);
        
        if (reviewsRefs.length !== reviewsArtifacts.length) {
            throw new Error("MISMATCHED_EVIDENCE: Review refs array length does not match artifacts array length");
        }

        for (let i = 0; i < reviewsRefs.length; i++) {
            assertContentReferenceMatches(reviewsRefs[i], reviewsArtifacts[i]);
            if (reviewsArtifacts[i].subject_ref.hash !== promotionRef.hash) {
                throw new Error("REJECT_REPLAY_DECISION_MISMATCH");
            }
        }

        // 2. Canonicalize evidence refs (deterministic sorting by hash)
        const canonicalEvidenceRefs = [...reviewsRefs].sort((a, b) => a.hash.localeCompare(b.hash));

        // 3. Determine governance result
        // Simplified logic: If any reviewer rejected, reject. 
        // If someone requested changes, request changes.
        // Otherwise, approve.
        let finalDecision: GovernanceDecision = "APPROVE";
        for (const review of reviewsArtifacts) {
            if (review.decision === "REJECT") {
                finalDecision = "REJECT";
                break;
            } else if (review.decision === "REQUEST_CHANGES") {
                finalDecision = "REQUEST_CHANGES";
            }
        }

        // At least one review is required if the policy says so.
        // (Assuming the policy requires reviews for PROMOTION_DECISION here)
        const rule = policyArtifact.rules.find(r => r.artifact_type === "PROMOTION_DECISION");
        if (rule && rule.requires_review && canonicalEvidenceRefs.length === 0) {
            finalDecision = "REJECT";
        }

        return {
            artifact_type: "GOVERNANCE_APPROVAL",
            promotion_decision_ref: promotionRef,
            evidence_refs: canonicalEvidenceRefs,
            governance_policy_ref: policyRef,
            governance_result: finalDecision,
            decided_by: decidedBy,
            rationale
        };
    }
}
