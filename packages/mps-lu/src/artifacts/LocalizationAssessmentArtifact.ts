import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/artifacts/ArtifactContract";
import { AssessmentFinding, RuleId, RuleVersion } from "../domain/AssessmentFinding";

export interface LocalizationAssessmentPayload {
  readonly project_context_ref: ArtifactReference;
  readonly property_ref: ArtifactReference;
  readonly findings: readonly AssessmentFinding[];
  readonly evidence_refs: readonly ArtifactReference[];
  readonly rule_refs: readonly {
    readonly rule_id: RuleId;
    readonly rule_version: RuleVersion;
  }[];
  readonly system_summary: string;
  readonly consultant_commentary_ref?: ArtifactReference;
}

export interface LocalizationAssessmentArtifact extends ArtifactContract {
  readonly artifact_type: "LOCALIZATION_ASSESSMENT";
  readonly payload: LocalizationAssessmentPayload;
}
