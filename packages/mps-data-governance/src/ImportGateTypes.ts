// packages/mps-data-governance/src/ImportGateTypes.ts

import type {
  ArtifactReference,
  CanonicalArtifact,
  ContentReference,
  Timestamp,
} from "../../mps-core/src/types";
import type { DatasetApprovalArtifact } from "./DatasetApprovalArtifact";

export type ImportGateDecision = "ALLOW_IMPORT" | "BLOCK_IMPORT";

export interface ComplianceCheckResult {
  readonly control_id: string;
  readonly result: "PASS" | "FAIL";
}

export interface ImportGateRequest {
  readonly manifest_ref: ContentReference;
  readonly approval_artifact: DatasetApprovalArtifact | null;
  readonly compliance_results: readonly ComplianceCheckResult[];
}

/**
 * The binding envelope — the ONLY thing passed to createSignedArtifactIdentity.
 * evaluated_at is intentionally absent from this type.
 */
export interface ImportGateEvidenceEnvelope {
  readonly artifact_type: "IMPORT_GATE_EVIDENCE";
  readonly decision: ImportGateDecision;
  readonly manifest_ref: ContentReference;
  readonly approval_ref: ContentReference | null;
  readonly failed_controls: readonly string[];
}

/**
 * IMPORT-TIME-001
 * evaluated_at MUST be externally supplied.
 * evaluated_at SHALL NOT participate in canonical identity.
 */
export interface ImportGateEvidenceArtifact
  extends Omit<CanonicalArtifact, "artifact_type">,
    ImportGateEvidenceEnvelope {
  readonly evaluated_at: Timestamp;
}

/**
 * What actually gets hashed/signed.
 */
export type ImportGateSignableEnvelope = Omit<
  ImportGateEvidenceArtifact,
  "artifact_id" | "content_hash" | "signature" | "evaluated_at"
>;

export interface ImportGateResult {
  readonly decision: ImportGateDecision;
  readonly manifest_ref: ContentReference;
  readonly approval_ref: ContentReference | null;
  readonly failed_controls: readonly string[];
  readonly evaluated_at: Timestamp;
  readonly evidence_ref: ArtifactReference;
}
