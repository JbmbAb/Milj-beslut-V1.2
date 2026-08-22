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
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. The exact LocalizationGeometryArtifact this assessment
   * was produced for. Optional only for historical assessments predating this field (their
   * `content_hash` must stay byte-identical -- see the same "undefined dropped by canonicalizer"
   * reasoning used throughout this unit); every new assessment on the V3 path carries it, and
   * `assessmentProjection.ts` uses it to require current-geometry eligibility for "current".
   */
  readonly localization_geometry_ref?: ArtifactReference;
}

/** Inputs known before the kernel has produced its outcome and attestation. */
export interface LocalizationAssessmentDraft {
  readonly site_id: string;
  readonly project_context_ref: ArtifactReference;
  readonly property_ref: ArtifactReference;
  readonly evidence_refs: readonly ArtifactReference[];
  readonly system_summary: string;
  readonly consultant_commentary_ref?: ArtifactReference;
  /** PRODUCT-LU-LOCALIZATION-GEOMETRY-01 -- see LocalizationAssessmentPayload. */
  readonly localization_geometry_ref?: ArtifactReference;
}

export interface LocalizationAssessmentArtifact extends ArtifactContract {
  readonly artifact_type: "LOCALIZATION_ASSESSMENT";
  readonly payload: LocalizationAssessmentPayload;
}
