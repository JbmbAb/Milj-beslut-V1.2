import { ContentReference } from "../types.js";
import { GovernanceApprovalArtifact } from "../artifacts/GovernanceApprovalArtifact.js";

export interface RegistryEntry {
    artifact_ref: ContentReference;             // promoted artifact (e.g. EVOLUTION_CANDIDATE)
    promotion_decision_ref: ContentReference;   // PromotionDecisionArtifact
    governance_approval_ref: ContentReference;  // GovernanceApprovalArtifact
    version: string;
}

export class RegistryValidator {
    /**
     * Registry SHALL verify references and approval status before accepting the registry update.
     */
    static verify(
        entry: RegistryEntry,
        approvalArtifact: GovernanceApprovalArtifact
    ): void {
        if (entry.governance_approval_ref.hash !== approvalArtifact.content_hash) {
            throw new Error("APPROVAL_REFERENCE_MISMATCH");
        }

        if (approvalArtifact.promotion_decision_ref.hash !== entry.promotion_decision_ref.hash) {
            throw new Error("PROMOTION_REFERENCE_MISMATCH");
        }

        if (approvalArtifact.governance_result !== "APPROVE") {
            throw new Error("REGISTRY_UPDATE_REJECTED: Governance approval must be APPROVE");
        }
    }
}
