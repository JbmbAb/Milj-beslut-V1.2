import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { AssessmentFinding, RuleId, RuleVersion } from "../domain/AssessmentFinding";

export interface LocalizationAssessmentPayload {
  readonly project_context_ref: ArtifactReference;
  readonly property_ref: ArtifactReference;
  /** HM1-C: the exact governed execution outcome this assessment materializes. */
  readonly execution_outcome_ref: ArtifactReference;
  /** HM1-C: integrity attestation over that outcome. */
  readonly outcome_attestation_ref: ArtifactReference;
  readonly findings: readonly AssessmentFinding[];
  readonly evidence_refs: readonly ArtifactReference[];
  readonly rule_refs: readonly {
    readonly rule_id: RuleId;
    readonly rule_version: RuleVersion;
  }[];
  readonly system_summary: string;
  readonly consultant_commentary_ref?: ArtifactReference;
}

/** Inputs known before the kernel has produced its outcome and attestation. */
export interface LocalizationAssessmentDraft {
  readonly site_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly property_ref: ArtifactReference;
  readonly evidence_refs: readonly ArtifactReference[];
  readonly system_summary: string;
  readonly consultant_commentary_ref?: ArtifactReference;
}

export interface LocalizationAssessmentArtifact extends ArtifactContract {
  readonly artifact_type: "LOCALIZATION_ASSESSMENT";
  readonly payload: LocalizationAssessmentPayload;
}
