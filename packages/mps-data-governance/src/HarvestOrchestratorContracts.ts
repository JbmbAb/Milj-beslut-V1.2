import type { ContentReference } from "../../mps-core/src/types";
import type { HarvestExecutionRequest, ComplianceCheckResult } from "./ImportGateTypes";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";

export interface HarvestExecutor {
  execute(request: { readonly source_id: string }): Promise<ContentReference>;
}

export interface VerificationExecutor {
  verify(manifest_ref: ContentReference): Promise<ContentReference>;
}

export interface GovernanceReviewAwaiter {
  /**
   * Returns approval ContentReference if resolved, otherwise returns null.
   * This is non-blocking (returns null if awaiting human input).
   */
  pollApproval(manifest_ref: ContentReference): Promise<ContentReference | null>;
}

export interface ComplianceRunner {
  run(manifest_ref: ContentReference, approval_ref: ContentReference): Promise<readonly ComplianceCheckResult[]>;
}

export interface ProjectionExecutor {
  project(input: {
    readonly gate_evidence_ref: ContentReference;
    readonly archive_refs: readonly ContentReference[];
  }): Promise<ContentReference>;
}

export interface LURuntimeInitializer {
  initialize(projection_ref: ContentReference): Promise<ContentReference>;
}
