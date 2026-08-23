import { ArtifactContract, ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import { AssessmentFinding, RuleId, RuleVersion } from "../domain/AssessmentFinding";

/**
 * LOCALIZATION-ASSESSMENT-CANONICAL-COLLECTIONS-V2 (CANONICAL-SEMANTIC-INPUTS-V1, H7).
 *
 * Frozen owner decision, per a concrete found defect: `evidence_refs` is semantically a SET (the
 * evidence that exists within a DWITHIN query's radius), but was previously hashed in whatever
 * order the sourcing SQL query happened to return rows -- Postgres gives no ordering guarantee
 * for such a query, so a genuine re-execution of the identical underlying evidence could
 * legitimately return it in a different row order, producing a DIFFERENT assessment identity for
 * a semantically identical answer. That is canonical nondeterminism, not presentation.
 *
 * V2 fixes this at the producer (see GovernedAssessmentPersistence.ts): `evidence_refs` is
 * deduplicated by canonical ref identity and sorted by an explicit stable key before entering the
 * hash domain. `findings` and `rule_refs` are left untouched -- both are already genuinely
 * ORDERED_SEQUENCEs (built by sequential code-order, `rule_refs` derived 1:1-positionally from
 * `findings`), confirmed by recon; sorting them would be a blanket normalization this contract
 * explicitly forbids.
 *
 * `assessment_contract_version` is OPTIONAL and absent on every historical assessment (same
 * "undefined dropped by canonicalizer" idiom already used for `localization_geometry_ref` below)
 * -- a legacy artifact's content_hash must stay byte-identical; it is never retroactively
 * rehashed or reinterpreted under V2 rules. Every new assessment sets it explicitly.
 */
export const LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2 = "localization-assessment-v2" as const;

export interface LocalizationAssessmentPayload {
  readonly project_context_ref: ArtifactReference;
  readonly property_ref: ArtifactReference;
  /** HM1-C: the exact governed execution outcome this assessment materializes. */
  readonly execution_outcome_ref: ArtifactReference;
  /** HM1-C: integrity attestation over that outcome. */
  readonly outcome_attestation_ref: ArtifactReference;
  /** ORDERED_SEQUENCE (confirmed by recon: sequential code-order, never reordered). */
  readonly findings: readonly AssessmentFinding[];
  /** SEMANTIC_SET (confirmed by recon) -- canonically deduplicated + sorted from V2 onward. */
  readonly evidence_refs: readonly ArtifactReference[];
  /** ORDERED_SEQUENCE (confirmed by recon: derived 1:1-positionally from `findings`). */
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
  /** LOCALIZATION-ASSESSMENT-CANONICAL-COLLECTIONS-V2. Absent on every historical assessment. */
  readonly assessment_contract_version?: typeof LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2;
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
