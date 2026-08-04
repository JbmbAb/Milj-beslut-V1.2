import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";

/**
 * RetentionPolicyArtifact
 *
 * Defines retention rules for artifacts.
 */
export interface RetentionPolicyArtifact extends ArtifactContract {
  readonly artifact_type: "retention_policy";

  readonly policy_name: string;
  readonly description: string;

  readonly max_retention_days: number;
  readonly preserve_evidence: boolean;
}
