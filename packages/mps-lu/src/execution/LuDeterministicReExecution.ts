import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import {
  validateFrozenExecutionOutcomeIdentity,
  type FrozenExecutionOutcomeIdentity,
} from "../../../mps-runtime/src/contracts/freeze/FrozenIdentities.js";
import { DefaultReplayEngine } from "../../../mps-runtime/src/replay/DefaultReplayEngine.js";
import type { SpatialEvidenceArtifact } from "../artifacts/SpatialEvidenceArtifact.js";
import { buildSpatialEvidenceContentHash } from "../artifacts/SpatialEvidenceIdentity.js";
import type { DocumentEvidenceArtifact } from "../artifacts/DocumentEvidenceArtifact.js";
import type {
  LocalizationAssessmentArtifact,
  LocalizationAssessmentPayload,
} from "../artifacts/LocalizationAssessmentArtifact.js";
import {
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
} from "../governance/GovernedAssessmentPersistence.js";
import { sha256ContentHash } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import { LURuleEngine } from "../rules/LURuleEngine.js";
import type { AssessmentFinding, RuleId, RuleVersion } from "../domain/AssessmentFinding.js";
import {
  isVerifiedDocumentFact,
  type VerifiedDocumentFactArtifact,
} from "../../../mps-data-governance/src/DocumentFactArtifact.js";

/**
 * LU-DETERMINISTIC-REEXECUTION-V1.
 *
 * Category B (re-execute-deterministically), explicitly separate from
 * `DefaultReplayEngine.replay()`/`replayFromManifestId()` (category A, verify-historical-
 * execution -- LU-REPLAY-COLD-VERIFY-V1). This does not change what REPLAY means; it is a new,
 * additive capability that actually re-runs `LURuleEngine.evaluate()` against the exact evidence
 * a stored assessment claims, and compares the result.
 *
 * Frozen invariants (owner-approved): CAS-only semantic inputs; no RuntimeState; no PostGIS; no
 * network; no "current" ProjectContextBinding/geometry/ProductRelease lookup; no DATABASE_URL
 * dependency; no system clock in the semantic evaluation; historical artifacts are never
 * rewritten or reinterpreted.
 *
 * KNOWN, DELIBERATE SCOPE GAP (do not silently paper over): `SpatialEvidenceArtifact` has a real,
 * reusable content-hash builder (`buildSpatialEvidenceContentHash`) that this module uses to
 * fully re-verify spatial evidence has not been tampered with since it was pinned. Neither
 * `DocumentEvidenceArtifact` nor `VerifiedDocumentFactArtifact` has an equivalent exported
 * hash-recomputation function anywhere in this codebase today -- their `content_hash`/
 * `artifact_id` are supplied by the caller at construction time in every constructor found
 * (`DocumentFactArtifact.ts`'s `verifyDocumentFactCandidate`), never derived from a documented,
 * reusable formula. This module therefore only re-verifies STRUCTURAL shape (type guard,
 * content_hash presence) for those two artifact families, not full tamper-proof re-hashing. This
 * is a real, named gap in the replay plan -- surfaced here rather than inventing an undocumented
 * hash formula to paper over it.
 *
 * FrozenExecutionOutcome V2 carries every input required for its own content-hash recomputation.
 * V1 remains historical-only because its old persisted shape omitted capability execution lineage.
 *
 * KNOWN, DELIBERATE SCOPE NOTE on finding order: `findings`/`rule_refs` are frozen as genuine
 * ORDERED_SEQUENCEs on the assessment artifact itself (H7) -- but that ordering reflects the RAW
 * evidence array order the original kernel run happened to receive, which is not itself a pinned,
 * recoverable value (only the canonically-sorted `evidence_refs` is pinned). Re-execution
 * therefore cannot reproduce byte-identical array order and does not claim to; it compares
 * findings/rule_refs as CANONICALIZED SETS (sorted by finding_id / rule_id+rule_version), which
 * is the semantically meaningful guarantee ("the same evidence produces the same findings") and
 * is order-independent by construction, since `finding_id` is deterministic from the evidence
 * artifact_id alone, never from array position.
 */

export type LuReExecutionMismatchCode =
  | "FINDINGS_MISMATCH"
  | "RULE_REFS_MISMATCH"
  | "EVIDENCE_SET_MISMATCH"
  | "MANIFEST_ATTEMPT_MISMATCH"
  | "MISSING_PINNED_EVIDENCE"
  | "TAMPERED_EVIDENCE"
  | "UNSUPPORTED_CONTRACT_VERSION";

export interface LuReExecutionMismatch {
  readonly code: LuReExecutionMismatchCode;
  readonly detail: string;
}

export interface LuReExecutionResult {
  readonly outcome: "PASS" | "DENY";
  readonly assessment_artifact_id: string;
  readonly mismatches: readonly LuReExecutionMismatch[];
  readonly fresh_findings: readonly AssessmentFinding[];
  readonly fresh_rule_refs: readonly { readonly rule_id: RuleId; readonly rule_version: RuleVersion }[];
}

function canonicalFindingsKey(findings: readonly AssessmentFinding[]): readonly AssessmentFinding[] {
  return [...findings]
    .sort((a, b) => (a.finding_id < b.finding_id ? -1 : a.finding_id > b.finding_id ? 1 : 0))
    .map((finding) => ({
      finding_id: finding.finding_id,
      rule_id: finding.rule_id,
      rule_version: finding.rule_version,
      risk_level: finding.risk_level,
      evidence_refs: finding.evidence_refs,
      explanation: finding.explanation,
    }));
}

function canonicalRuleRefsKey(
  refs: readonly { readonly rule_id: RuleId; readonly rule_version: RuleVersion }[],
): readonly { readonly rule_id: RuleId; readonly rule_version: RuleVersion }[] {
  return [...refs].sort((a, b) => {
    const ka = `${a.rule_id}:${a.rule_version}`;
    const kb = `${b.rule_id}:${b.rule_version}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

/**
 * Resolves EVERY ref in `evidence_refs` from CAS. Never throws for a missing/tampered ref --
 * collects a mismatch per ref instead, so a caller gets the full picture, not just the first
 * failure.
 */
async function resolveEvidence(args: {
  readonly evidenceRefs: readonly ArtifactReference[];
  readonly artifactRepository: ArtifactRepositoryPort;
}): Promise<{
  readonly spatial_evidence: SpatialEvidenceArtifact[];
  readonly document_evidence: DocumentEvidenceArtifact[];
  readonly verified_document_facts: VerifiedDocumentFactArtifact[];
  readonly mismatches: LuReExecutionMismatch[];
}> {
  const spatial_evidence: SpatialEvidenceArtifact[] = [];
  const document_evidence: DocumentEvidenceArtifact[] = [];
  const verified_document_facts: VerifiedDocumentFactArtifact[] = [];
  const mismatches: LuReExecutionMismatch[] = [];

  for (const ref of args.evidenceRefs) {
    let resolved: unknown;
    try {
      resolved = await args.artifactRepository.resolve(ref);
    } catch {
      mismatches.push({
        code: "MISSING_PINNED_EVIDENCE",
        detail: `${ref.artifact_type}:${ref.artifact_id} is pinned in evidence_refs but could not be resolved from CAS`,
      });
      continue;
    }

    const artifact = resolved as { artifact_type?: string; artifact_id?: string; content_hash?: { algorithm: string; value: string }; payload?: unknown };
    if (ref.artifact_type === "SPATIAL_EVIDENCE") {
      const spatial = artifact as unknown as SpatialEvidenceArtifact;
      const recomputed = buildSpatialEvidenceContentHash(spatial.payload);
      if (recomputed.value !== spatial.content_hash?.value) {
        mismatches.push({
          code: "TAMPERED_EVIDENCE",
          detail: `SPATIAL_EVIDENCE:${ref.artifact_id} content_hash does not match its own payload (recomputed ${recomputed.value}, stored ${spatial.content_hash?.value})`,
        });
        continue;
      }
      spatial_evidence.push(spatial);
    } else if (ref.artifact_type === "DOCUMENT_EVIDENCE") {
      if (!artifact.content_hash?.value) {
        mismatches.push({
          code: "TAMPERED_EVIDENCE",
          detail: `DOCUMENT_EVIDENCE:${ref.artifact_id} has no content_hash -- cannot even structurally confirm it is the pinned artifact`,
        });
        continue;
      }
      document_evidence.push(artifact as unknown as DocumentEvidenceArtifact);
    } else if (ref.artifact_type === "VERIFIED_DOCUMENT_FACT") {
      if (!isVerifiedDocumentFact(artifact as unknown as VerifiedDocumentFactArtifact)) {
        mismatches.push({
          code: "TAMPERED_EVIDENCE",
          detail: `VERIFIED_DOCUMENT_FACT:${ref.artifact_id} resolved but is not structurally a verified fact (wrong artifact_type or verification_status)`,
        });
        continue;
      }
      verified_document_facts.push(artifact as unknown as VerifiedDocumentFactArtifact);
    } else {
      mismatches.push({
        code: "EVIDENCE_SET_MISMATCH",
        detail: `${ref.artifact_type}:${ref.artifact_id} is pinned in evidence_refs but is not one of the three evidence families LURuleEngine accepts (SPATIAL_EVIDENCE / DOCUMENT_EVIDENCE / VERIFIED_DOCUMENT_FACT)`,
      });
    }
  }

  return { spatial_evidence, document_evidence, verified_document_facts, mismatches };
}

/**
 * The category-B entry point. `assessmentArtifactId` is the only required input -- everything
 * else is derived from CAS-pinned refs reachable from that one artifact.
 */
export async function reExecuteLocalizationAssessment(args: {
  readonly assessmentArtifactId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
}): Promise<LuReExecutionResult> {
  const assessment = await args.artifactRepository.resolve<LocalizationAssessmentArtifact>({
    artifact_id: args.assessmentArtifactId,
    artifact_type: "LOCALIZATION_ASSESSMENT",
  });

  // Self-consistency first, before trusting ANY field on the resolved assessment (including
  // execution_outcome_ref) -- same recompute-and-compare GovernedAssessmentPersistence.persist()
  // already does at write time (localizationAssessmentCanonicalBody + sha256ContentHash), just
  // exercised here at read time. Without this, a resolved assessment whose execution_outcome_ref
  // was swapped for an unrelated (but internally self-consistent) execution's outcome would pass
  // every other check in this module -- there is no other independent claim to cross-check the
  // pinned execution identity against. Mapped to MANIFEST_ATTEMPT_MISMATCH: a self-inconsistent
  // assessment's claimed execution chain cannot be trusted, which is exactly what that code means.
  const recomputedAssessmentHash = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
  if (recomputedAssessmentHash.value !== assessment.content_hash.value) {
    return {
      outcome: "DENY",
      assessment_artifact_id: args.assessmentArtifactId,
      mismatches: [{
        code: "MANIFEST_ATTEMPT_MISMATCH",
        detail: `assessment ${args.assessmentArtifactId}'s content_hash does not match its own payload (recomputed ${recomputedAssessmentHash.value}, stored ${assessment.content_hash.value}) -- its claimed execution_outcome_ref cannot be trusted`,
      }],
      fresh_findings: [],
      fresh_rule_refs: [],
    };
  }

  // Contract-version dispatch (H12): frozen legacy rule for absent version, strict structural
  // rule for V2, fail closed on anything else -- reused verbatim, never re-implemented here.
  try {
    validateLocalizationAssessmentContractVersion(assessment.payload as LocalizationAssessmentPayload);
  } catch (error) {
    return {
      outcome: "DENY",
      assessment_artifact_id: args.assessmentArtifactId,
      mismatches: [{
        code: "UNSUPPORTED_CONTRACT_VERSION",
        detail: error instanceof Error ? error.message : String(error),
      }],
      fresh_findings: [],
      fresh_rule_refs: [],
    };
  }

  // Category A first: the outcome/attempt/manifest identity chain must independently check out
  // before category B ever runs. This is deliberate composition, not scope creep -- re-executing
  // an assessment whose own execution identity doesn't verify would prove nothing.
  const outcome = await args.artifactRepository.resolve<FrozenExecutionOutcomeIdentity>(
    assessment.payload.execution_outcome_ref,
  );
  try {
    validateFrozenExecutionOutcomeIdentity(outcome);
  } catch (error) {
    return {
      outcome: "DENY",
      assessment_artifact_id: args.assessmentArtifactId,
      mismatches: [{
        code: "MANIFEST_ATTEMPT_MISMATCH",
        detail: error instanceof Error ? error.message : String(error),
      }],
      fresh_findings: [],
      fresh_rule_refs: [],
    };
  }
  const manifestIdFromAttemptRef = deriveManifestIdFromAttemptId(outcome.attempt_ref.artifact_id);
  const replayEngine = new DefaultReplayEngine(args.artifactRepository);
  try {
    await replayEngine.replayFromManifestId(manifestIdFromAttemptRef);
  } catch (error) {
    return {
      outcome: "DENY",
      assessment_artifact_id: args.assessmentArtifactId,
      mismatches: [{
        code: "MANIFEST_ATTEMPT_MISMATCH",
        detail: error instanceof Error ? error.message : String(error),
      }],
      fresh_findings: [],
      fresh_rule_refs: [],
    };
  }
  const attempt = await args.artifactRepository.resolve<{ manifest_ref: ArtifactReference }>(outcome.attempt_ref);
  if (attempt.manifest_ref.artifact_id !== manifestIdFromAttemptRef) {
    return {
      outcome: "DENY",
      assessment_artifact_id: args.assessmentArtifactId,
      mismatches: [{
        code: "MANIFEST_ATTEMPT_MISMATCH",
        detail: `outcome.attempt_ref (${outcome.attempt_ref.artifact_id}) does not carry the manifest_id its own id implies`,
      }],
      fresh_findings: [],
      fresh_rule_refs: [],
    };
  }

  const { spatial_evidence, document_evidence, verified_document_facts, mismatches } = await resolveEvidence({
    evidenceRefs: assessment.payload.evidence_refs,
    artifactRepository: args.artifactRepository,
  });
  if (mismatches.length > 0) {
    return {
      outcome: "DENY",
      assessment_artifact_id: args.assessmentArtifactId,
      mismatches,
      fresh_findings: [],
      fresh_rule_refs: [],
    };
  }

  const freshFindings = new LURuleEngine().evaluate({ spatial_evidence, document_evidence, verified_document_facts });
  const freshRuleRefs = freshFindings.map((f) => ({ rule_id: f.rule_id, rule_version: f.rule_version }));

  const comparisonMismatches: LuReExecutionMismatch[] = [];
  const storedFindingsCanonical = canonicalFindingsKey(assessment.payload.findings);
  const freshFindingsCanonical = canonicalFindingsKey(freshFindings);
  if (JSON.stringify(storedFindingsCanonical) !== JSON.stringify(freshFindingsCanonical)) {
    comparisonMismatches.push({
      code: "FINDINGS_MISMATCH",
      detail: `re-executed findings (canonicalized) do not match the stored assessment's findings. stored=${JSON.stringify(storedFindingsCanonical.map((f) => f.finding_id))} fresh=${JSON.stringify(freshFindingsCanonical.map((f) => f.finding_id))}`,
    });
  }
  const storedRuleRefsCanonical = canonicalRuleRefsKey(assessment.payload.rule_refs);
  const freshRuleRefsCanonical = canonicalRuleRefsKey(freshRuleRefs);
  if (JSON.stringify(storedRuleRefsCanonical) !== JSON.stringify(freshRuleRefsCanonical)) {
    comparisonMismatches.push({
      code: "RULE_REFS_MISMATCH",
      detail: `re-executed rule_refs (canonicalized) do not match the stored assessment's rule_refs.`,
    });
  }

  return {
    outcome: comparisonMismatches.length === 0 ? "PASS" : "DENY",
    assessment_artifact_id: args.assessmentArtifactId,
    mismatches: comparisonMismatches,
    fresh_findings: freshFindings,
    fresh_rule_refs: freshRuleRefs,
  };
}

function deriveManifestIdFromAttemptId(attemptId: string): string {
  const match = /^attempt-(.+)-1$/.exec(attemptId);
  if (!match) {
    throw new Error(`REJECT_REEXECUTION: attempt_id "${attemptId}" does not match the expected attempt-\${manifest_id}-1 shape`);
  }
  return match[1]!;
}
