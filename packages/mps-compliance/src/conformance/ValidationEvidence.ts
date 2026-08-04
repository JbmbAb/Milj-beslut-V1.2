import { ArtifactReference } from "../artifacts/ArtifactReference";

/**
 * ValidationEvidence
 *
 * Records deterministic proof of a validation observation.
 */
export interface ValidationEvidence {
  readonly evidence_id: string;
  readonly rule_id: string;
  readonly artifact_ref: ArtifactReference;
  readonly observation: string;
  readonly created_at: string;
}
