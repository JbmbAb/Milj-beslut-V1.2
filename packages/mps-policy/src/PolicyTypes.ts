import type { ContentReference } from "@miljobeslut/mps-core";

export type PolicyDecisionType = "ALLOW" | "REVIEW" | "BLOCK";

export interface PolicyDecisionArtifact {
  readonly decision_id: string;

  readonly runtime_id: string;

  readonly policy_set_id: string;
  readonly policy_set_hash: string;

  readonly policy_id: string;
  readonly policy_version: string;
  readonly policy_hash: string;

  readonly decision: PolicyDecisionType;
  readonly reason: string;

  readonly input_hash: string;

  readonly evaluated_at: string;

  readonly decision_hash: string;
}

export interface PolicySetArtifact {
  readonly schema_version: "policy.v1";
  readonly policy_set_id: string;
  readonly policy_set_hash: string;

  readonly policies: readonly {
    readonly policy_id: string;
    readonly policy_version: string;
    readonly policy_hash: string;
    readonly content: Uint8Array;
  }[];
}

export interface PolicyInput {
  readonly runtime_id: string;
  readonly registry_snapshot_id: string;
  readonly registry_hash: string;

  readonly stage: string;
  readonly reference: ContentReference;

  readonly artifact?: unknown;
  readonly metadata: Record<string, unknown>;
}

export type PolicyReviewState = "PENDING" | "APPROVED" | "REJECTED";

export interface PolicyApproval {
  readonly review_id: string;
  readonly decision_id: string;

  readonly reviewer: string;
  readonly approved_at: string;
  readonly signature: string;

  readonly state: PolicyReviewState;
}

export interface PolicyApprovalStore {
  getByDecisionId(decision_id: string): Promise<PolicyApproval | null>;
}
