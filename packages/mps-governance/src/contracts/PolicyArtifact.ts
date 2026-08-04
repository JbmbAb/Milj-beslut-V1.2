import { CanonicalArtifact, ContentReference } from "@miljobeslut/mps-evolution";
import { GovernanceArtifact } from "./GovernanceArtifact.js";

// GOV-POL-24-17-I5: Policy Scope Binding
export interface PolicyScope {
  readonly applicable_domain: string;
  readonly applicable_artifact_types: readonly string[];
  readonly effective_version_range: string;
}

export interface PolicyArtifact extends GovernanceArtifact {
  readonly artifact_type: "POLICY_ARTIFACT";

  readonly policy_scope: PolicyScope; // Must be present
}

export interface PromotionPolicyArtifact extends PolicyArtifact {
  // Promotion specific rules
  readonly promotion_rules: unknown;
}

export interface ApprovalPolicyArtifact extends PolicyArtifact {
  // Approval specific rules
  readonly approval_rules: unknown;
}
