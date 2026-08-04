import { ContentReference } from "@miljobeslut/mps-evolution";
import { PolicyArtifact } from "../contracts/PolicyArtifact.js";
import { ApprovalArtifact } from "../contracts/ApprovalArtifact.js";
import { DecisionArtifact } from "../contracts/DecisionArtifact.js";

export interface GovernanceEngine {
  createPolicy(
    policy_key: string,
    policy_version: string,
    rules: readonly { rule_key: string; expression: string }[]
  ): Promise<PolicyArtifact>;

  createApproval(
    governance_key: string,
    governance_version: string,
    subject_ref: ContentReference,
    policy_ref: ContentReference
  ): Promise<ApprovalArtifact>;

  createDecision(
    governance_key: string,
    governance_version: string,
    subject_ref: ContentReference,
    approval_ref: ContentReference
  ): Promise<DecisionArtifact>;
}
