import type { ContentReference, ArtifactReference } from "../../mps-core/src/types";
import type { HarvestExecutionRequest } from "./HarvestOrchestratorTypes";
import type { ComplianceCheckResult } from "./ImportGateTypes";

export interface Clock {
  /**
   * Returns a deterministic, ISO 8601 UTC timestamp.
   * IMPORT-TIME-001 / Orchestrator never generates timestamps internally.
   */
  now(): string;
}

export type HarvestExecutionOutcome =
  | { readonly kind: "DOWNLOAD_MANIFEST"; readonly ref: ContentReference }
  | { readonly kind: "PREFETCH_EVIDENCE"; readonly ref: ContentReference };

export interface HarvestExecutor {
  execute(request: HarvestExecutionRequest): Promise<HarvestExecutionOutcome>;
}

export function requireDownloadManifestRef(outcome: HarvestExecutionOutcome): ContentReference {
  if (outcome.kind !== "DOWNLOAD_MANIFEST") {
    throw new Error(
      "REJECT_PREFETCH_RESULT: this caller requires a download manifest and received prefetch evidence.",
    );
  }
  return outcome.ref;
}

export interface VerificationExecutor {
  verify(manifest_ref: ContentReference): Promise<ArtifactReference>;
}

export interface GovernanceReviewAwaiter {
  /**
   * Returns approval ArtifactReference if resolved, otherwise returns null.
   * This is non-blocking (returns null if awaiting human input).
   */
  pollApproval(manifest_ref: ContentReference): Promise<ArtifactReference | null>;
}

export interface ComplianceRunner {
  run(manifest_ref: ContentReference, approval_ref: ArtifactReference): Promise<readonly ComplianceCheckResult[]>;
}

export interface ProjectionExecutor {
  project(input: {
    readonly gate_evidence_ref: ArtifactReference;
    readonly archive_refs: readonly ContentReference[];
  }): Promise<ArtifactReference>;
}

export interface LURuntimeInitializer {
  initialize(projection_ref: ArtifactReference): Promise<ArtifactReference>;
}
