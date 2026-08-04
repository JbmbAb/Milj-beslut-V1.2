import { ArtifactContract } from "../../../mps-compliance/src/artifacts/ArtifactContract";

export type VerificationStatus = "verified" | "failed" | "inconclusive";

/**
 * VerificationResultArtifact
 *
 * Deterministic verification result.
 */
export interface VerificationResultArtifact extends ArtifactContract {
  readonly artifact_type: "verification_result";

  readonly status: VerificationStatus;
  readonly reason_code: string;
}
