import { describe, expect, it } from "vitest";
import { sha256ContentHash } from "../../mps-runtime/src/kernel/ExecutionKernel";
import { InMemoryArtifactRepository } from "../../mps-runtime/src/repository/InMemoryArtifactRepository";
import { SecurityRuntime } from "../../mps-runtime/src/security/SecurityRuntime";
import {
  createGovernedLocalizationAssessment,
  GovernedAssessmentPersistence,
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
  LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2,
  LOCALIZATION_ASSESSMENT_CANONICALIZER_ID_V2,
  type LocalizationAssessmentArtifact,
  type LocalizationAssessmentDraft,
} from "../src/index";

/**
 * LU-ASSESSMENT-CONTRACT-VERSIONING-V1 (H12 closure).
 *
 * Recon found `assessment_contract_version`/`canonicalizer_id` already wired into the sole
 * production constructor and a real dispatch validator already defined -- but the validator was
 * never called from the actual persistence path, so it was correct but not load-bearing. This
 * proves both required invariants directly, and (via the `persist()` calls) proves the wiring
 * added to GovernedAssessmentPersistence.persist() actually enforces them, not just that the
 * validator function itself is correct in isolation.
 */
const PROJECT_CONTEXT_REF = { artifact_id: "lu_project_context-h12", artifact_type: "LU_PROJECT_CONTEXT" } as const;
const PROPERTY_REF = { artifact_id: "property-h12", artifact_type: "PROPERTY" } as const;

function buildOutcomeAndAttestation(seedTag: string) {
  const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: `h12-${seedTag}` });
  security.bindPrincipal("lu.site_assessment.actor");
  const outcome = {
    outcome_id: `outcome-h12-${seedTag}`,
    artifact_type: "execution_outcome" as const,
    attempt_ref: { artifact_id: "attempt-h12", artifact_type: "execution_attempt" },
    result: "success" as const,
    content_hash: sha256ContentHash({ result: "success", tag: seedTag }),
  };
  const attestation = security.attestOutcome(outcome.content_hash);
  return { security, outcome, attestation };
}

function draft(): LocalizationAssessmentDraft {
  return {
    site_id: "site-h12",
    project_context_ref: PROJECT_CONTEXT_REF,
    property_ref: PROPERTY_REF,
    evidence_refs: [{ artifact_id: "evidence-h12-a", artifact_type: "SGU_RISK" }],
    system_summary: "H12 contract-versioning proof",
  };
}

/** Strips the V2 version fields and recomputes content_hash/artifact_id -- simulates the real
 *  byte shape of a historical assessment minted before this contract-version field existed,
 *  rather than merely deleting fields off an otherwise-V2 artifact and leaving stale identity. */
function asLegacyV1Shape(v2: LocalizationAssessmentArtifact): LocalizationAssessmentArtifact {
  const { assessment_contract_version, canonicalizer_id, ...legacyPayload } = v2.payload;
  const identityBody = { artifact_type: v2.artifact_type, references: v2.references, payload: legacyPayload };
  const contentHash = sha256ContentHash(identityBody);
  return {
    artifact_id: `assessment-${contentHash.value}`,
    ...identityBody,
    content_hash: contentHash,
  } as LocalizationAssessmentArtifact;
}

describe("LU-ASSESSMENT-CONTRACT-VERSIONING-V1 (H12)", () => {
  it("negative proof A: same semantic payload under different assessment_contract_version must not alias to the same identity", () => {
    const { outcome, attestation } = buildOutcomeAndAttestation("alias-a");
    const v2 = createGovernedLocalizationAssessment({ draft: draft(), findings: [], outcome, attestation });
    const legacy = asLegacyV1Shape(v2);

    expect(v2.payload.assessment_contract_version).toBe(LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V2);
    expect(legacy.payload.assessment_contract_version).toBeUndefined();
    // Every other semantic field is identical -- only the version fields differ.
    expect(legacy.payload.project_context_ref).toEqual(v2.payload.project_context_ref);
    expect(legacy.payload.evidence_refs).toEqual(v2.payload.evidence_refs);
    expect(legacy.payload.execution_outcome_ref).toEqual(v2.payload.execution_outcome_ref);

    expect(legacy.artifact_id).not.toBe(v2.artifact_id);
    expect(legacy.content_hash.value).not.toBe(v2.content_hash.value);
  });

  it("negative proof B: a historical (legacy V1) assessment remains valid under its own producing contract after V2 is the live default", async () => {
    const { outcome, attestation } = buildOutcomeAndAttestation("historical-b");
    const v2 = createGovernedLocalizationAssessment({ draft: draft(), findings: [], outcome, attestation });
    const legacy = asLegacyV1Shape(v2);

    // The dispatch validator's V1 branch: absent version -> legacy shape, no extra requirements
    // -- must not throw, and must not be silently routed through the V2-only structural rules
    // (canonicalizer_id match, canonical evidence_refs form) that a real V1 record never satisfies
    // by construction (it has no canonicalizer_id at all).
    expect(() => validateLocalizationAssessmentContractVersion(legacy.payload)).not.toThrow();

    // End-to-end: GovernedAssessmentPersistence.persist() (now wired to call the dispatch
    // validator on every persist) still accepts this legacy artifact. Re-derive outcome/
    // attestation for `legacy`'s own execution_outcome_ref/outcome_attestation_ref (unchanged
    // from `v2`, since only the version fields were stripped) using the SAME security instance
    // that signed them, so verification succeeds.
    const repo = new InMemoryArtifactRepository();
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: "h12-historical-b-persist" });
    security.bindPrincipal("lu.site_assessment.actor");
    const legacyOutcome = {
      outcome_id: legacy.payload.execution_outcome_ref.artifact_id,
      artifact_type: legacy.payload.execution_outcome_ref.artifact_type as "execution_outcome",
      attempt_ref: { artifact_id: "attempt-h12", artifact_type: "execution_attempt" },
      result: "success" as const,
      content_hash: sha256ContentHash({ result: "success", tag: "historical-b-persist" }),
    };
    const legacyAttestation = security.attestOutcome(legacyOutcome.content_hash);
    const legacyWithRealOutcome = asLegacyV1Shape(
      createGovernedLocalizationAssessment({ draft: draft(), findings: [], outcome: legacyOutcome, attestation: legacyAttestation }),
    );
    const persistence = new GovernedAssessmentPersistence(repo, (candidate) => security.verifyAttestation(candidate));
    await expect(
      persistence.persist({ artifact: legacyWithRealOutcome, outcome: legacyOutcome, attestation: legacyAttestation }),
    ).resolves.toMatchObject({ artifact_id: legacyWithRealOutcome.artifact_id });
  });

  it("canonical persist enforcement: a V2 artifact with a tampered canonicalizer_id is rejected by persist(), not merely by the validator in isolation", async () => {
    const { outcome, attestation } = buildOutcomeAndAttestation("tampered-canonicalizer");
    const v2 = createGovernedLocalizationAssessment({ draft: draft(), findings: [], outcome, attestation });
    const tamperedPayload = { ...v2.payload, canonicalizer_id: "sv-canonical-1" as unknown as typeof LOCALIZATION_ASSESSMENT_CANONICALIZER_ID_V2 };
    const identityBody = { artifact_type: v2.artifact_type, references: v2.references, payload: tamperedPayload };
    const contentHash = sha256ContentHash(identityBody);
    const tampered: LocalizationAssessmentArtifact = {
      artifact_id: `assessment-${contentHash.value}`,
      ...identityBody,
      content_hash: contentHash,
    };

    const repo = new InMemoryArtifactRepository();
    const security = SecurityRuntime.create({ bootstrapAdmit: true, bindSeed: "h12-tampered-canonicalizer" });
    const persistence = new GovernedAssessmentPersistence(repo, (candidate) => security.verifyAttestation(candidate));
    await expect(
      persistence.persist({ artifact: tampered, outcome, attestation }),
    ).rejects.toThrow(/contract_version/);
  });

  it("canonical body hashing is version-agnostic by construction -- localizationAssessmentCanonicalBody hashes whichever shape is actually present", () => {
    const { outcome, attestation } = buildOutcomeAndAttestation("canonical-body");
    const v2 = createGovernedLocalizationAssessment({ draft: draft(), findings: [], outcome, attestation });
    const legacy = asLegacyV1Shape(v2);
    expect(sha256ContentHash(localizationAssessmentCanonicalBody(v2)).value).toBe(v2.content_hash.value);
    expect(sha256ContentHash(localizationAssessmentCanonicalBody(legacy)).value).toBe(legacy.content_hash.value);
  });
});
