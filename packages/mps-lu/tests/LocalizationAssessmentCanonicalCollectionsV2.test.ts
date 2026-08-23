import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { SecurityRuntime } from "../../mps-runtime/src/security/SecurityRuntime";
import {
  createGovernedLocalizationAssessment,
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
  LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2,
  LOCALIZATION_ASSESSMENT_CANONICALIZER_ID_V2,
  type LocalizationAssessmentDraft,
} from "../src/index";

const PROJECT_CONTEXT_REF = { artifact_id: "lu_project_context-h7", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const PROPERTY_REF = { artifact_id: "property-h7", artifact_type: "PROPERTY" } as const;

function buildOutcomeAndAttestation(seedTag: string) {
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `h7-${seedTag}` });
  security.bindPrincipal("lu.site_assessment.actor");
  const outcome = {
    outcome_id: `outcome-h7-${seedTag}`,
    artifact_type: "execution_outcome" as const,
    attempt_ref: { artifact_id: "attempt-h7", artifact_type: "execution_attempt" },
    result: "success" as const,
    content_hash: sha256ContentHash({ result: "success", tag: seedTag }),
  };
  const attestation = security.attestOutcome(outcome.content_hash);
  return { outcome, attestation };
}

function draftWithEvidence(evidenceRefs: readonly { artifact_id: string; artifact_type: string }[]): LocalizationAssessmentDraft {
  return {
    site_id: "site-h7",
    project_context_ref: PROJECT_CONTEXT_REF,
    property_ref: PROPERTY_REF,
    evidence_refs: evidenceRefs,
    system_summary: "H7 canonical collections test",
  };
}

describe("LOCALIZATION-ASSESSMENT-CANONICAL-COLLECTIONS-V2 (H7 Phase B)", () => {
  it("stamps assessment_contract_version = v2 on every new assessment", () => {
    const { outcome, attestation } = buildOutcomeAndAttestation("stamp");
    const assessment = createGovernedLocalizationAssessment({
      draft: draftWithEvidence([{ artifact_id: "evidence-a", artifact_type: "SGU_RISK" }]),
      findings: [],
      outcome,
      attestation,
    });
    expect(assessment.payload.assessment_contract_version).toBe(LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2);
  });

  it("THE CORE FIX: the same semantic evidence set, supplied in a different (SQL-row-order-like) sequence, produces the IDENTICAL assessment identity", () => {
    const evidenceA = { artifact_id: "evidence-a", artifact_type: "SGU_RISK" };
    const evidenceB = { artifact_id: "evidence-b", artifact_type: "NVR" };
    const evidenceC = { artifact_id: "evidence-c", artifact_type: "VISS" };

    const { outcome: outcome1, attestation: attestation1 } = buildOutcomeAndAttestation("order-1");
    const assessmentOrderABC = createGovernedLocalizationAssessment({
      draft: draftWithEvidence([evidenceA, evidenceB, evidenceC]),
      findings: [],
      outcome: outcome1,
      attestation: attestation1,
    });

    // Simulate a genuine re-execution of the identical underlying query returning the same rows
    // in a DIFFERENT order (Postgres gives no ordering guarantee for a DWITHIN existence query).
    const { outcome: outcome2, attestation: attestation2 } = buildOutcomeAndAttestation("order-1"); // same seed tag -> same outcome/attestation refs
    const assessmentOrderCAB = createGovernedLocalizationAssessment({
      draft: draftWithEvidence([evidenceC, evidenceA, evidenceB]),
      findings: [],
      outcome: outcome2,
      attestation: attestation2,
    });

    expect(assessmentOrderABC.payload.evidence_refs).toEqual(assessmentOrderCAB.payload.evidence_refs);
    expect(assessmentOrderABC.artifact_id).toBe(assessmentOrderCAB.artifact_id);
    expect(assessmentOrderABC.content_hash.value).toBe(assessmentOrderCAB.content_hash.value);
  });

  it("evidence_refs is deduplicated by canonical ref identity before sorting", () => {
    const evidenceA = { artifact_id: "evidence-a", artifact_type: "SGU_RISK" };
    const { outcome, attestation } = buildOutcomeAndAttestation("dedup");
    const assessment = createGovernedLocalizationAssessment({
      draft: draftWithEvidence([evidenceA, evidenceA, evidenceA]),
      findings: [],
      outcome,
      attestation,
    });
    expect(assessment.payload.evidence_refs).toHaveLength(1);
  });

  it("references (top-level) is constructed FROM the already-canonical evidence_refs -- also order-stable across a row-order change", () => {
    const evidenceA = { artifact_id: "evidence-a", artifact_type: "SGU_RISK" };
    const evidenceB = { artifact_id: "evidence-b", artifact_type: "NVR" };
    const { outcome: o1, attestation: a1 } = buildOutcomeAndAttestation("refs-1");
    const first = createGovernedLocalizationAssessment({ draft: draftWithEvidence([evidenceA, evidenceB]), findings: [], outcome: o1, attestation: a1 });
    const { outcome: o2, attestation: a2 } = buildOutcomeAndAttestation("refs-1");
    const second = createGovernedLocalizationAssessment({ draft: draftWithEvidence([evidenceB, evidenceA]), findings: [], outcome: o2, attestation: a2 });
    expect(first.references).toEqual(second.references);
  });

  it("localizationAssessmentCanonicalBody + sha256ContentHash reproduces the SAME hash for both orderings -- the fix holds at the actual hash-domain boundary, not just a field-level equality", () => {
    const evidenceA = { artifact_id: "evidence-a", artifact_type: "SGU_RISK" };
    const evidenceB = { artifact_id: "evidence-b", artifact_type: "NVR" };
    const { outcome: o1, attestation: a1 } = buildOutcomeAndAttestation("hash-domain");
    const first = createGovernedLocalizationAssessment({ draft: draftWithEvidence([evidenceA, evidenceB]), findings: [], outcome: o1, attestation: a1 });
    const { outcome: o2, attestation: a2 } = buildOutcomeAndAttestation("hash-domain");
    const second = createGovernedLocalizationAssessment({ draft: draftWithEvidence([evidenceB, evidenceA]), findings: [], outcome: o2, attestation: a2 });

    const hash1 = sha256ContentHash(localizationAssessmentCanonicalBody(first));
    const hash2 = sha256ContentHash(localizationAssessmentCanonicalBody(second));
    expect(hash1.value).toBe(hash2.value);
  });

  it("H2/H12: explicit version dispatch -- absent version (legacy V1 shape) passes with no extra requirements", () => {
    expect(() =>
      validateLocalizationAssessmentContractVersion({
        project_context_ref: { artifact_id: "p", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "prop", artifact_type: "PROPERTY" },
        execution_outcome_ref: { artifact_id: "o", artifact_type: "execution_outcome" },
        outcome_attestation_ref: { artifact_id: "a", artifact_type: "attestation" },
        findings: [],
        evidence_refs: [{ artifact_id: "z", artifact_type: "X" }, { artifact_id: "a", artifact_type: "X" }], // deliberately unsorted -- legal for V1
        rule_refs: [],
        system_summary: "legacy",
      }),
    ).not.toThrow();
  });

  it("H2/H12: a real V2 assessment passes the explicit V2 structural check", () => {
    const { outcome, attestation } = buildOutcomeAndAttestation("dispatch-v2");
    const assessment = createGovernedLocalizationAssessment({
      draft: draftWithEvidence([{ artifact_id: "evidence-b", artifact_type: "NVR" }, { artifact_id: "evidence-a", artifact_type: "SGU_RISK" }]),
      findings: [],
      outcome,
      attestation,
    });
    expect(() => validateLocalizationAssessmentContractVersion(assessment.payload)).not.toThrow();
    expect(assessment.payload.canonicalizer_id).toBe(LOCALIZATION_ASSESSMENT_CANONICALIZER_ID_V2);
  });

  it("H2/H12: a V2-labeled payload with an unsorted evidence_refs (mislabeled or tampered) is rejected -- the version claim alone is not trusted", () => {
    expect(() =>
      validateLocalizationAssessmentContractVersion({
        project_context_ref: { artifact_id: "p", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "prop", artifact_type: "PROPERTY" },
        execution_outcome_ref: { artifact_id: "o", artifact_type: "execution_outcome" },
        outcome_attestation_ref: { artifact_id: "a", artifact_type: "attestation" },
        findings: [],
        evidence_refs: [{ artifact_id: "z", artifact_type: "X" }, { artifact_id: "a", artifact_type: "X" }], // NOT canonically sorted
        rule_refs: [],
        system_summary: "tampered",
        assessment_contract_version: LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2,
        canonicalizer_id: LOCALIZATION_ASSESSMENT_CANONICALIZER_ID_V2,
      }),
    ).toThrow(/evidence_refs is not the canonical/);
  });

  it("H2/H12: a V2-labeled payload with the wrong canonicalizer_id is rejected", () => {
    expect(() =>
      validateLocalizationAssessmentContractVersion({
        project_context_ref: { artifact_id: "p", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "prop", artifact_type: "PROPERTY" },
        execution_outcome_ref: { artifact_id: "o", artifact_type: "execution_outcome" },
        outcome_attestation_ref: { artifact_id: "a", artifact_type: "attestation" },
        findings: [],
        evidence_refs: [],
        rule_refs: [],
        system_summary: "tampered",
        assessment_contract_version: LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2,
        canonicalizer_id: "some-other-canonicalizer" as never,
      }),
    ).toThrow(/canonicalizer_id mismatch/);
  });

  it("H2/H12: an unknown assessment_contract_version fails closed, never silently treated as V1 or V2", () => {
    expect(() =>
      validateLocalizationAssessmentContractVersion({
        project_context_ref: { artifact_id: "p", artifact_type: "LU_PROJECT_CONTEXT" },
        property_ref: { artifact_id: "prop", artifact_type: "PROPERTY" },
        execution_outcome_ref: { artifact_id: "o", artifact_type: "execution_outcome" },
        outcome_attestation_ref: { artifact_id: "a", artifact_type: "attestation" },
        findings: [],
        evidence_refs: [],
        rule_refs: [],
        system_summary: "future",
        assessment_contract_version: "localization-assessment-v99" as never,
      }),
    ).toThrow(/unknown assessment_contract_version/);
  });

  it("a genuinely different evidence set (not just reordered) still produces a DIFFERENT identity -- the fix stabilizes representation, it does not collapse distinct evidence", () => {
    const evidenceA = { artifact_id: "evidence-a", artifact_type: "SGU_RISK" };
    const evidenceB = { artifact_id: "evidence-b", artifact_type: "NVR" };
    const evidenceD = { artifact_id: "evidence-d", artifact_type: "RAA" };
    const { outcome: o1, attestation: a1 } = buildOutcomeAndAttestation("distinct-1");
    const withAB = createGovernedLocalizationAssessment({ draft: draftWithEvidence([evidenceA, evidenceB]), findings: [], outcome: o1, attestation: a1 });
    const { outcome: o2, attestation: a2 } = buildOutcomeAndAttestation("distinct-1");
    const withAD = createGovernedLocalizationAssessment({ draft: draftWithEvidence([evidenceA, evidenceD]), findings: [], outcome: o2, attestation: a2 });
    expect(withAB.artifact_id).not.toBe(withAD.artifact_id);
  });
});
