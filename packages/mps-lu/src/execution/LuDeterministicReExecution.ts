import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactContract";
import type { ArtifactRepositoryPort } from "../../../mps-runtime/src/kernel/ExecutionKernel.js";
import {
  validateFrozenExecutionOutcomeIdentity,
  type FrozenCapabilityExecutionArtifact,
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
import { evaluateLuRuleSet } from "./LuExecutionKernelClient.js";
import type { AssessmentFinding, RuleId, RuleVersion } from "../domain/AssessmentFinding.js";
import {
  isVerifiedDocumentFact,
  type VerifiedDocumentFactArtifact,
} from "../../../mps-data-governance/src/DocumentFactArtifact.js";
import { isVerifiedDocumentFactContentHashValid } from "../../../mps-data-governance/src/verifyRealDocumentFactCandidate.js";
import {
  isDocumentEvidenceV2,
  isDocumentEvidenceV2ContentHashValid,
  type DocumentEvidenceArtifactV2,
} from "../artifacts/DocumentEvidenceArtifactV2.js";
import {
  NOT_CHECKED_CAUSE_SOURCE_UNAVAILABLE,
  NOT_CHECKED_FINDING_ID_PREFIX,
  isHistoricalNotCheckedExplanation,
} from "../rules/LURuleEngine.js";
import {
  LuReExecutionStorageError,
  isArtifactNotFound,
  readPinnedArtifact,
  type LuReExecutionStage,
} from "./LuReExecutionStorageError.js";
import { executionIdentityCanonicalBody } from "./ExecutionIdentityAttestation.js";
import type { ExecutionIdentityArtifact } from "../../../mps-runtime/src/execution/ExecutionIdentityArtifact.js";
import {
  computeExecutionManifestIdV3,
  type ExecutionIdentitySubjectV3,
} from "../../../mps-runtime/src/execution/ExecutionIdentityScopeV2.js";
import {
  LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V3,
  LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V4,
} from "../artifacts/LocalizationAssessmentArtifact.js";
import {
  assertBootstrapAdmitFlagOnlyInExplicitTestProcess,
  isBootstrapExecutionReplayAllowed,
} from "./LuReExecutionBootstrapAllowance.js";

/**
 * LU-DETERMINISTIC-REEXECUTION-V1.
 *
 * Category B (re-execute-deterministically), explicitly separate from
 * `DefaultReplayEngine.replay()`/`replayFromManifestId()` (category A, verify-historical-
 * execution -- LU-REPLAY-COLD-VERIFY-V1). This does not change what REPLAY means; it is a new,
 * additive capability that actually re-runs the canonical LU rule evaluator against the exact evidence
 * a stored assessment claims, and compares the result.
 *
 * Frozen invariants (owner-approved): CAS-only semantic inputs; no RuntimeState; no PostGIS; no
 * network; no "current" ProjectContextBinding/geometry/ProductRelease lookup; no DATABASE_URL
 * dependency; no system clock in the semantic evaluation; historical artifacts are never
 * rewritten or reinterpreted.
 *
 * H15-DOCUMENT-EVIDENCE-REHASH-COLD-REPLAY-V1 (closes most of the gap below): `VerifiedDocumentFactArtifact`
 * now has a real, reusable self-consistency check (`isVerifiedDocumentFactContentHashValid`,
 * mps-data-governance/verifyRealDocumentFactCandidate.ts) and `DocumentEvidenceArtifactV2` now
 * has one too (`isDocumentEvidenceV2ContentHashValid`, DocumentEvidenceArtifactV2.ts). Both are
 * exercised below for every resolved artifact of those types -- a stored hash is no longer
 * trusted merely because it is present.
 *
 * REMAINING, DELIBERATE SCOPE GAP: `DocumentEvidenceArtifact` V1 (mandatory `property_ref`,
 * `packages/mps-lu/src/artifacts/DocumentEvidenceArtifact.ts`) still has no documented, reusable
 * hash-recomputation formula anywhere in this codebase -- its `content_hash`/`artifact_id` were
 * always supplied by the caller at construction time, never derived. V1 is frozen historical
 * semantics (OWNER DECISION 2026-08-24, DOCUMENT-EVIDENCE-PROPERTY-BINDING-CONTRACT-V2): this
 * module continues to only re-verify STRUCTURAL shape (content_hash presence) for a V1-shaped
 * `DOCUMENT_EVIDENCE` artifact (no `payload.contract_version` field), exactly as before --
 * inventing an undocumented V1 hash formula here would be exactly the kind of silent historical
 * reinterpretation the owner decision forbids. V2 (discriminated by
 * `payload.contract_version === "document-evidence-v2"`) gets the full independent rehash.
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
 *
 * U30-R2 (NOT_CHECKED replay within the existing contracts; owner 2026-10-02: no new artifact
 * type). A NOT_CHECKED layer finding is a function of its layer alone (LURuleEngine), and WHICH
 * layers were not checked is re-derived from the attested execution -- the CAPABILITY_EXECUTION
 * pinned by the validated v2 outcome, re-hashed (`attestedExecution`) -- never from the
 * stored findings under comparison: an added, removed or rewritten NOT_CHECKED finding therefore
 * still mismatches. A historical NOT_CHECKED finding whose explanation embeds the provider's
 * never-pinned free text is reproduced in every semantic field; its wording difference is reported
 * as the machine-readable notice NOT_CHECKED_CAUSE_NOT_PINNED, not as a mismatch.
 *
 * U30-R3 K1 (OD-R2). Every CAS read and write on the replay chain -- the assessment, its outcome, the
 * category-A replay's attempt/manifest/v2-outcome locator and REPLAY record, the pinned evidence, the
 * attested execution and its capability definition -- separates two things: a genuine absence (the
 * repository's exact "Artifact not found: <id>") of a PINNED artifact is an integrity/binding failure
 * and becomes a DENY; any other failure is a storage fault and rejects with the typed technical error
 * LuReExecutionStorageError (code LU_REEXECUTION_STORAGE_FAULT, the stage, the original fault as
 * cause) -- never a DENY and never a silent fallback. The assessment itself is the caller's input,
 * not a pinned artifact: its absence keeps the repository's own not-found error.
 *
 * U30-R3 K2 (verifier F1/F5/F6). The binding between the assessment and the execution it names is
 * checked in BOTH directions, never by trusting either side:
 *  - assessment -> execution: the assessment's own hash covers execution_outcome_ref; the v2 outcome
 *    hashes capability_execution_ref and attempt_ref; the CAPABILITY_EXECUTION is re-hashed from its
 *    outputs (`attestedExecution`).
 *  - execution -> assessment: the execution's output_refs must be EXACTLY the finding ids
 *    re-executed from the assessment's own pinned, re-hashed evidence (layer findings carry the
 *    evidence artifact id) plus the NOT_CHECKED layers -- nothing missing, nothing extra. A removed
 *    or fabricated HIGH, a junk output, or another assessment's outcome (verifier X3) is
 *    MANIFEST_ATTEMPT_MISMATCH.
 *  - for a V4 assessment additionally: its AuthorityEvidence (id re-derived from its content) names
 *    exactly one V3 ExecutionIdentity (content hash as pinned there); that identity's subject must
 *    derive the very manifest the outcome's attempt belongs to, and name the assessment's
 *    localization point (`authoritySubjectBinding`). This closes the redirect that output binding
 *    alone cannot see: an assessment with no evidence-derived finding pointed at another no-hit
 *    run's outcome.
 * What this proves is deterministic consistency of the replay against the pinned artifacts. It does
 * NOT prove authenticity: no signature is checked here (U30R3-REPORT, "Vad verify inte bevisar").
 *
 * U30-R4 (owner 2026-10-03 (4) item 7; U30-R3 verifier F1) -- the anti-downgrade binding. The V4 binding
 * above applies only to an assessment that itself declares V4, so a forger could drop the authority
 * evidence, relabel the assessment V1-V3 and point it at another assessment's outcome. Every v2 outcome
 * (FROZEN_EXECUTION_OUTCOME_CONTRACT_VERSION_V2, d8b18cd9, 2026-08-24) postdates the V1/V2 assessment
 * contracts and the canonical V3-subject product path (6fdd1186), so for an assessment over a v2 outcome
 * (`executionSubjectBinding`):
 *  - a V1/V2 label is CONTRACT_DOWNGRADE_REFUSED: no code that wrote V1/V2 assessments ever wrote a v2
 *    outcome (33c19b58, which made every new assessment V3, is an ancestor of d8b18cd9);
 *  - a V3 assessment must be bound to the canonical V3 subject its execution was derived from: the
 *    manifest names the execution identity, whose V3 subject must derive that very manifest id
 *    (preimage-bound, never trusted from a stored claim), and the assessment's localization point must be
 *    the subject's. Otherwise EXECUTION_SUBJECT_MISMATCH;
 *  - an execution that cannot be bound at all -- a legacy site/V2-scoped manifest, or a V3-subject manifest
 *    whose identity was never issued (bootstrap admission) -- is EXECUTION_SUBJECT_UNBOUND, unless the
 *    verifying process is an explicit test bootstrap (isBootstrapExecutionReplayAllowed: the flag "1" AND
 *    NODE_ENV exactly "test" AND APP_ENV exactly "test" or "ci" -- U30-R5, the K0 model).
 * The same holds one level down (the outcome-level downgrade): the pinned outcome must be the outcome the
 * execution recorded -- the one category A replays (`outcome-v2-<attempt>` when it exists, else the legacy
 * V1 locator). A V1 outcome pinned for an execution that recorded a v2 outcome is CONTRACT_DOWNGRADE_REFUSED;
 * any other outcome than the replayed one is MANIFEST_ATTEMPT_MISMATCH. Without this a minted V1 outcome
 * (no lineage) would skip the output and subject bindings, for V4 as well -- on the SAME attempt.
 * A genuine V1 outcome (before 2026-08-24) carries no lineage and is otherwise left as before (R-1). A V3 relabel of a
 * V4 over its OWN execution and point cannot be told from a V3 made while V3 was canonical (2026-08-24 ..
 * 2026-09-16): nothing in the execution chain records that the run required authority (U30R4-REPORT).
 *
 * U30-R5 (U30R4-VERIFICATION V1, HIGH) -- what U30-R4 does NOT close, stated here because the U30-R4 header and
 * report claimed more: the outcome-level check binds the pinned outcome only to the attempt THAT OUTCOME names.
 * A canonical V4 can still be rewritten to V1, V2 or V3 and pinned to a V1-format outcome on ANOTHER attempt --
 * a freshly minted chain (manifest + attempt + V1 outcome: three new CAS objects) or any genuine execution from
 * before 2026-08-24 -- with any point and its HIGH removed, and verify gives PASS, also with NODE_ENV=production:
 * a V1 outcome carries no lineage, so no output or subject binding applies to it. Only a forward marker in the
 * execution chain or attestation verification can close that; neither is built. This and every other residual
 * is listed in LU_REEXECUTION_CONSISTENCY_KNOWN_LIMITATION (./LuReExecutionKnownLimitation.ts, deliberately not a
 * package-root export) -- verify is consistency, not authenticity.
 *
 * U30-R5 flag gate: MPS_LU_BOOTSTRAP_ADMIT present (any value) in a process that is not an explicit test process
 * makes verify refuse to run at all, before any CAS read (LuBootstrapAdmitFlagOutsideTestError,
 * BOOTSTRAP_ADMIT_FLAG_OUTSIDE_TEST): a configuration error, never a verdict and never excusable.
 *
 * U30-R6 (owner decision 2026-10-02/03, BINDING): the V1 form is accepted until U51 as an explicit PRODUCT LIMITATION,
 * with a mandatory machine-readable notice on EVERY PASS that rests on a V1/legacy-unbound artifact form. Every result
 * carries an explicit binding strength (`verification_binding`), derived ONLY from what the checks above actually
 * established -- never from the assessment's label:
 *  - "LEGACY_UNBOUND_FORM": the pinned outcome is a V1-format outcome (no execution lineage, so no output or subject
 *    binding applies -- any label, V4 included), or a v2 outcome whose execution has no governed subject and was
 *    accepted only because the verifying process is an explicit test bootstrap (in the product configuration that is
 *    EXECUTION_SUBJECT_UNBOUND, a DENY). Such a PASS always carries the notice LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY
 *    first in `notices` (authenticity_verified false, current_authority_verified false, the owner's Swedish text).
 *  - "FULLY_BOUND": a v2 outcome (exact output binding) AND a positively established subject binding (V4: the
 *    authority subject; V3: the execution subject). Consistency only -- NOT authenticity: forms the KNOWN_LIMITATION
 *    lists as not detectable here (a V3 relabel of a V4, unbound subject axes, a fully fabricated or in-place rewritten
 *    bound chain, an identity minted after the fact) are FULLY_BOUND as well. No attestation is checked.
 *  - a DENY has no strength (`null`) and never the notice.
 * The verdict (PASS/DENY) is unchanged by U30-R6; only the notice and the strength are added. EXECUTION_SUBJECT_UNBOUND
 * carries its own Swedish text (`text_sv`), distinct from the deviation/tampering wording.
 */

export type LuReExecutionMismatchCode =
  | "FINDINGS_MISMATCH"
  | "RULE_REFS_MISMATCH"
  | "EVIDENCE_SET_MISMATCH"
  | "MANIFEST_ATTEMPT_MISMATCH"
  | "MISSING_PINNED_EVIDENCE"
  | "TAMPERED_EVIDENCE"
  | "UNSUPPORTED_CONTRACT_VERSION"
  /** U30-R4: a V1/V2 assessment over a v2 outcome -- a contract older than the execution it pins. */
  | "CONTRACT_DOWNGRADE_REFUSED"
  /** U30-R4: a V3 assessment over a canonical V3-subject execution it is not bound to (point, subject). */
  | "EXECUTION_SUBJECT_MISMATCH"
  /** U30-R4: a V3 assessment over an execution with no governed subject (bootstrap/legacy), product configuration. */
  | "EXECUTION_SUBJECT_UNBOUND";

/**
 * U30-R6 (owner: UNBOUND gets its own text, distinct from manipulation). Neutral: an execution without a governed
 * subject is not a finding that anything was changed -- and not a proof of the opposite either.
 */
export const LU_REEXECUTION_UNBOUND_TEXT_SV =
  "Reproducerbarheten kan inte bekräftas: körningen bakom bedömningen saknar ett styrt exekveringssubjekt (äldre eller obunden körningsform) och kan inte bindas till bedömningen. Resultatet påstår inte att underlaget har ändrats." as const;

export type LuReExecutionMismatch =
  | {
      readonly code: Exclude<LuReExecutionMismatchCode, "EXECUTION_SUBJECT_UNBOUND">;
      readonly detail: string;
    }
  | {
      readonly code: "EXECUTION_SUBJECT_UNBOUND";
      readonly detail: string;
      /** U30-R6: its own Swedish text (LU_REEXECUTION_UNBOUND_TEXT_SV), never the generic deviation/tampering text. */
      readonly text_sv: typeof LU_REEXECUTION_UNBOUND_TEXT_SV;
    };

/**
 * U30-R6 -- the explicit, machine-readable strength of a verify PASS (see the module header). A consumer must never
 * show a "LEGACY_UNBOUND_FORM" PASS as the same green verification as a "FULLY_BOUND" one; neither means authenticity.
 */
export type LuReExecutionVerificationBinding = "FULLY_BOUND" | "LEGACY_UNBOUND_FORM";

/** U30-R6 -- which detectable older/unbound form a LEGACY_UNBOUND_FORM PASS rests on. */
export type LuReExecutionLegacyUnboundBasis =
  /** The pinned outcome is a V1-format outcome without execution lineage (any assessment label, V4 included). */
  | "V1_FORM"
  /**
   * A v2 outcome whose execution has no governed subject (a legacy site/V2-scoped manifest, or a V3-subject manifest
   * whose identity is not in CAS), accepted only because the verifying process is an explicit test bootstrap.
   */
  | "LEGACY_UNBOUND";

/** U30-R6 -- the owner's wording (2026-10-02/03), verbatim. */
export const LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV =
  "Reproducerbar konsistens verifierad för äldre obunden artefaktform – äkthet och aktuell authority är inte verifierade." as const;

/**
 * U30-R2 -- the listed historical NOT_CHECKED findings were reproduced from the attested execution in layer, rule,
 * version, risk level and evidence, but their stored explanation embeds the provider's free-text cause, which was
 * never pinned and so can neither be reproduced nor contradicted ("kan inte återskapas: orsaken sparades inte").
 * PRES-24 token, kept from the U30-R proposal.
 */
export interface LuReExecutionNotCheckedCauseNotPinnedNotice {
  readonly code: "NOT_CHECKED_CAUSE_NOT_PINNED";
  readonly finding_ids: readonly string[];
  readonly detail: string;
}

/**
 * U30-R6 (owner decision 2026-10-02/03; the name awaits the owner's approval) -- mandatory on every PASS that rests on
 * a V1/legacy-unbound artifact form, and on no other result: consistency with the pinned artifacts was verified,
 * authenticity and current authority were not. Always the FIRST notice of such a PASS.
 */
export interface LuReExecutionLegacyUnboundFormNotice {
  readonly code: "LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY";
  readonly basis: LuReExecutionLegacyUnboundBasis;
  readonly authenticity_verified: false;
  readonly current_authority_verified: false;
  readonly text_sv: typeof LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV;
  /** Always empty: the notice is about the whole verification, not about individual findings. */
  readonly finding_ids: readonly [];
  /** Technical detail (ids only). */
  readonly detail: string;
}

/** Machine-readable statuses that are NOT deviations and never turn a PASS into a DENY (or the reverse). */
export type LuReExecutionNotice = LuReExecutionNotCheckedCauseNotPinnedNotice | LuReExecutionLegacyUnboundFormNotice;

interface LuReExecutionResultFields {
  readonly assessment_artifact_id: string;
  readonly mismatches: readonly LuReExecutionMismatch[];
  readonly fresh_findings: readonly AssessmentFinding[];
  readonly fresh_rule_refs: readonly { readonly rule_id: RuleId; readonly rule_version: RuleVersion }[];
  /**
   * U30-R2 -- machine-readable statuses that are NOT deviations and never turn PASS into DENY. Always present; `[]`
   * when there is none. U30-R6: a LEGACY_UNBOUND_FORM PASS has exactly one LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY
   * notice, first; a FULLY_BOUND PASS and a DENY have none.
   */
  readonly notices: readonly LuReExecutionNotice[];
}

/**
 * U30-R6: discriminated by `outcome` -- a PASS always states its binding strength, a DENY has none (`null`).
 */
export type LuReExecutionResult =
  | (LuReExecutionResultFields & {
      readonly outcome: "PASS";
      readonly verification_binding: LuReExecutionVerificationBinding;
    })
  | (LuReExecutionResultFields & {
      readonly outcome: "DENY";
      readonly verification_binding: null;
    });

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
 * failure. U30-R3 K1 (OD-R2): "missing" means the repository's exact never-stored signal; any
 * other read failure is a storage fault and rejects with LuReExecutionStorageError (stage
 * `pinned_evidence`) instead of being reported as MISSING_PINNED_EVIDENCE.
 *
 * Exported (H15-DOCUMENT-EVIDENCE-REHASH-COLD-REPLAY-V1) so real cold-replay proofs can exercise
 * evidence resolution directly against real CAS state without needing a full
 * LocalizationAssessmentArtifact wrapping it.
 */
export async function resolveEvidence(args: {
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
    const read = await readPinnedArtifact<unknown>(args.artifactRepository, ref, "pinned_evidence");
    if (!read.found) {
      mismatches.push({
        code: "MISSING_PINNED_EVIDENCE",
        detail: `${ref.artifact_type}:${ref.artifact_id} is pinned in evidence_refs but is not in CAS`,
      });
      continue;
    }
    const resolved = read.value;

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
      // Version dispatch (never reinterpret V1 as V2): a V2 artifact declares
      // payload.contract_version explicitly; a real V1 artifact has no such field at all.
      const docEvidence = artifact as unknown as DocumentEvidenceArtifact | DocumentEvidenceArtifactV2;
      if (isDocumentEvidenceV2(docEvidence)) {
        if (!isDocumentEvidenceV2ContentHashValid(docEvidence)) {
          mismatches.push({
            code: "TAMPERED_EVIDENCE",
            detail: `DOCUMENT_EVIDENCE:${ref.artifact_id} (V2) content_hash does not match its own carried fields -- tampered or malformed`,
          });
          continue;
        }
      }
      // else: V1-shaped (no contract_version) -- structural-only, exactly as before. See the
      // file-header note: no documented, reusable V1 hash formula exists, and none is invented
      // here; V1 remains frozen historical semantics.
      document_evidence.push(artifact as unknown as DocumentEvidenceArtifact);
    } else if (ref.artifact_type === "VERIFIED_DOCUMENT_FACT") {
      if (!isVerifiedDocumentFact(artifact as unknown as VerifiedDocumentFactArtifact)) {
        mismatches.push({
          code: "TAMPERED_EVIDENCE",
          detail: `VERIFIED_DOCUMENT_FACT:${ref.artifact_id} resolved but is not structurally a verified fact (wrong artifact_type or verification_status)`,
        });
        continue;
      }
      if (!isVerifiedDocumentFactContentHashValid(artifact as unknown as VerifiedDocumentFactArtifact)) {
        mismatches.push({
          code: "TAMPERED_EVIDENCE",
          detail: `VERIFIED_DOCUMENT_FACT:${ref.artifact_id} content_hash does not match its own carried fields -- tampered or malformed`,
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
  // U30-R5 flag gate, before anything is read: MPS_LU_BOOTSTRAP_ADMIT present outside an explicit test process is a
  // configuration error of this process -- verify refuses to run (typed, never a verdict, never excusable).
  assertBootstrapAdmitFlagOnlyInExplicitTestProcess(process.env, "reexecution");
  // U30-R4/U30-R5: decided once, before any await -- whether this process is an explicit test bootstrap that may
  // accept an execution with no governed subject (the K0 model). The product configuration never is.
  const bootstrapExecutionsAllowed = isBootstrapExecutionReplayAllowed(process.env);
  // The caller's input, not a pinned artifact: a genuine absence keeps the repository's own
  // not-found error; a storage fault is the typed technical error (OD-R2).
  const assessmentRead = await readPinnedArtifact<LocalizationAssessmentArtifact>(
    args.artifactRepository,
    { artifact_id: args.assessmentArtifactId, artifact_type: "LOCALIZATION_ASSESSMENT" },
    "assessment",
  );
  if (assessmentRead.found === false) throw assessmentRead.error;
  const assessment = assessmentRead.value;
  // Every DENY before the comparison: no findings, no notices, and no binding strength (U30-R6).
  const deniedAll = (mismatches: readonly LuReExecutionMismatch[]): LuReExecutionResult => ({
    outcome: "DENY",
    verification_binding: null,
    assessment_artifact_id: args.assessmentArtifactId,
    mismatches,
    fresh_findings: [],
    fresh_rule_refs: [],
    notices: [],
  });
  const denied = (mismatch: LuReExecutionMismatch): LuReExecutionResult => deniedAll([mismatch]);

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
    return denied({
      code: "MANIFEST_ATTEMPT_MISMATCH",
      detail: `assessment ${args.assessmentArtifactId}'s content_hash does not match its own payload (recomputed ${recomputedAssessmentHash.value}, stored ${assessment.content_hash.value}) -- its claimed execution_outcome_ref cannot be trusted`,
    });
  }

  // Contract-version dispatch (H12): frozen legacy rule for absent version, strict structural
  // rule for V2, fail closed on anything else -- reused verbatim, never re-implemented here.
  try {
    validateLocalizationAssessmentContractVersion(assessment.payload as LocalizationAssessmentPayload);
  } catch (error) {
    return denied({
      code: "UNSUPPORTED_CONTRACT_VERSION",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  // Category A first: the outcome/attempt/manifest identity chain must independently check out
  // before category B ever runs. This is deliberate composition, not scope creep -- re-executing
  // an assessment whose own execution identity doesn't verify would prove nothing.
  const outcomeRead = await readPinnedArtifact<FrozenExecutionOutcomeIdentity>(
    args.artifactRepository,
    assessment.payload.execution_outcome_ref,
    "execution_outcome",
  );
  if (!outcomeRead.found) {
    return denied({
      code: "MANIFEST_ATTEMPT_MISMATCH",
      detail: `execution outcome ${assessment.payload.execution_outcome_ref.artifact_id} pinned by the assessment is not in CAS`,
    });
  }
  const outcome = outcomeRead.value;
  try {
    validateFrozenExecutionOutcomeIdentity(outcome);
  } catch (error) {
    return denied({
      code: "MANIFEST_ATTEMPT_MISMATCH",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const manifestIdFromAttemptRef = deriveManifestIdFromAttemptId(outcome.attempt_ref.artifact_id);
  // OD-R2 inside category A: DefaultReplayEngine reads through a classifying view of the repository,
  // so a storage fault there is never mistaken for a broken chain -- including the v2-outcome locator
  // read it swallows on purpose (an absent locator means a historical V1 execution) and the REPLAY
  // record it writes. A genuine absence still reaches the engine as the repository's own not-found.
  const replayView = classifyingReplayRepository(args.artifactRepository);
  let replayedOutcomeRef: ArtifactReference;
  try {
    replayedOutcomeRef = (await new DefaultReplayEngine(replayView.repository).replayFromManifestId(manifestIdFromAttemptRef))
      .replayed_outcome_ref;
  } catch (error) {
    if (replayView.faults.length > 0) throw replayView.faults[0];
    return denied({
      code: "MANIFEST_ATTEMPT_MISMATCH",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  if (replayView.faults.length > 0) throw replayView.faults[0];
  // U30-R4 (outcome-level downgrade): the pinned outcome must be the outcome this execution recorded, i.e.
  // the one category A just replayed (the v2 outcome when the attempt has one, else the legacy V1 locator).
  // A V1 outcome carries no lineage, so one minted for a lineage-era attempt would otherwise skip the
  // output and subject bindings entirely -- for V4 too.
  const pinnedOutcomeRef = assessment.payload.execution_outcome_ref;
  if (replayedOutcomeRef.artifact_id !== pinnedOutcomeRef.artifact_id) {
    const v1PinnedOverV2 = !("capability_execution_ref" in outcome) && replayedOutcomeRef.artifact_id.startsWith("outcome-v2-");
    return denied({
      code: v1PinnedOverV2 ? "CONTRACT_DOWNGRADE_REFUSED" : "MANIFEST_ATTEMPT_MISMATCH",
      detail: v1PinnedOverV2
        ? `assessment pins the V1 outcome ${pinnedOutcomeRef.artifact_id}, but its execution recorded the v2 outcome ${replayedOutcomeRef.artifact_id}`
        : `assessment pins the outcome ${pinnedOutcomeRef.artifact_id}, but its execution's outcome is ${replayedOutcomeRef.artifact_id}`,
    });
  }
  const attemptRead = await readPinnedArtifact<{ manifest_ref: ArtifactReference }>(
    args.artifactRepository,
    outcome.attempt_ref,
    "execution_attempt",
  );
  if (!attemptRead.found) {
    return denied({
      code: "MANIFEST_ATTEMPT_MISMATCH",
      detail: `execution attempt ${outcome.attempt_ref.artifact_id} pinned by the outcome is not in CAS`,
    });
  }
  const attempt = attemptRead.value;
  if (attempt.manifest_ref.artifact_id !== manifestIdFromAttemptRef) {
    return denied({
      code: "MANIFEST_ATTEMPT_MISMATCH",
      detail: `outcome.attempt_ref (${outcome.attempt_ref.artifact_id}) does not carry the manifest_id its own id implies`,
    });
  }

  // U30-R3 K2: a V4 assessment's authority subject must name the execution its outcome pins.
  const authorityBinding = await authoritySubjectBinding(assessment, manifestIdFromAttemptRef, args.artifactRepository);
  if (authorityBinding.kind === "mismatch") {
    return denied(authorityBinding.mismatch);
  }
  // U30-R4: a V1-V3 assessment over a v2 outcome is bound to its execution's subject, or refused.
  const subjectBinding = await executionSubjectBinding(
    assessment,
    outcome,
    attempt.manifest_ref,
    args.artifactRepository,
    bootstrapExecutionsAllowed,
  );
  if (subjectBinding.kind === "mismatch") {
    return denied(subjectBinding.mismatch);
  }
  // U30-R6: the strength of a PASS, from what the two checks above actually established (never from the label).
  const legacyUnboundForm = legacyUnboundFormNotice(
    outcome,
    pinnedOutcomeRef.artifact_id,
    attempt.manifest_ref.artifact_id,
    authorityBinding,
    subjectBinding,
  );

  const { spatial_evidence, document_evidence, verified_document_facts, mismatches } = await resolveEvidence({
    evidenceRefs: assessment.payload.evidence_refs,
    artifactRepository: args.artifactRepository,
  });
  if (mismatches.length > 0) {
    return deniedAll(mismatches);
  }

  // U30-R2: which layers the original run could not check comes from the attested execution only.
  const attested = await attestedExecution(outcome, args.artifactRepository);
  if ("mismatch" in attested) {
    return denied(attested.mismatch);
  }

  const freshFindings = evaluateLuRuleSet(
    spatial_evidence,
    document_evidence,
    verified_document_facts,
    attested.layers.map((dataset) => ({ dataset, reason: NOT_CHECKED_CAUSE_SOURCE_UNAVAILABLE })),
  );
  const freshRuleRefs = freshFindings.map((f) => ({ rule_id: f.rule_id, rule_version: f.rule_version }));

  // U30-R2: a historical NOT_CHECKED finding (wording with the never-pinned provider text) is
  // compared in today's wording -- only when the attested execution reproduced it and every other
  // field matches. Stored findings are read here only to compare, never to decide what exists.
  const freshById = new Map(freshFindings.map((finding) => [finding.finding_id, finding] as const));
  const causeNotPinned: string[] = [];
  const storedComparable = assessment.payload.findings.map((stored) => {
    const fresh = freshById.get(stored.finding_id);
    if (fresh && isHistoricalNotCheckedWordingOf(stored, fresh)) {
      causeNotPinned.push(stored.finding_id);
      return { ...stored, explanation: fresh.explanation };
    }
    return stored;
  });
  const notices: readonly LuReExecutionNotCheckedCauseNotPinnedNotice[] =
    causeNotPinned.length === 0
      ? []
      : [
          {
            code: "NOT_CHECKED_CAUSE_NOT_PINNED",
            finding_ids: [...causeNotPinned].sort(),
            detail:
              `NOT_CHECKED finding(s) ${JSON.stringify([...causeNotPinned].sort())} were reproduced from the attested execution ` +
              `(layer, rule, version, risk level, evidence); their stored explanation is the historical wording that embedded ` +
              `the provider's free-text cause, which was never pinned and is neither reproduced nor contradicted.`,
          },
        ];

  const comparisonMismatches: LuReExecutionMismatch[] = [];

  // U30-R3 K2: the attested execution must have produced EXACTLY the findings this assessment's own
  // pinned evidence re-executes to (as multisets of finding ids) -- not a subset, not a superset.
  // V1 outcomes carry no execution lineage (historical, predating NOT_CHECKED); nothing to bind.
  if (attested.output_ids !== null) {
    const outputBinding = exactOutputBindingMismatch(
      attested.execution_id,
      attested.output_ids,
      freshFindings.map((finding) => finding.finding_id),
    );
    if (outputBinding) comparisonMismatches.push(outputBinding);
  }

  const storedFindingsCanonical = canonicalFindingsKey(storedComparable);
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

  const compared = {
    assessment_artifact_id: args.assessmentArtifactId,
    mismatches: comparisonMismatches,
    fresh_findings: freshFindings,
    fresh_rule_refs: freshRuleRefs,
  };
  if (comparisonMismatches.length > 0) {
    return { outcome: "DENY", verification_binding: null, ...compared, notices };
  }
  // U30-R6 (owner, BINDING): a PASS over a V1/legacy-unbound form always says so, first; never the same green
  // verification as a fully bound one. The verdict itself is the comparison above, unchanged.
  if (legacyUnboundForm !== null) {
    return { outcome: "PASS", verification_binding: "LEGACY_UNBOUND_FORM", ...compared, notices: [legacyUnboundForm, ...notices] };
  }
  return { outcome: "PASS", verification_binding: "FULLY_BOUND", ...compared, notices };
}

/**
 * U30-R6 -- the LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY notice for a verification that rests on a V1/legacy-unbound form,
 * or null when the verification is fully bound (see the module header). Decided ONLY from what verify established:
 *  - a V1-format outcome (no capability execution lineage): no output or subject binding applied -> V1_FORM, whatever
 *    the assessment's label says (a V4 label over a V1 outcome is still V1 form);
 *  - a v2 outcome with a positively established subject binding (V4 authority subject, or V3 execution subject) ->
 *    fully bound (null);
 *  - otherwise LEGACY_UNBOUND: the execution had no governed subject and was accepted only in an explicit test
 *    bootstrap -- or, fail-closed for the presentation, no subject binding was established at all (no reachable PASS
 *    takes that branch today; it exists so that a PASS can never be FULLY_BOUND without a binding).
 */
function legacyUnboundFormNotice(
  outcome: FrozenExecutionOutcomeIdentity,
  pinnedOutcomeId: string,
  manifestId: string,
  authority: LuReExecutionBindingCheck,
  subject: LuReExecutionBindingCheck,
): LuReExecutionLegacyUnboundFormNotice | null {
  const notice = (basis: LuReExecutionLegacyUnboundBasis, detail: string): LuReExecutionLegacyUnboundFormNotice => ({
    code: "LEGACY_UNBOUND_FORM_CONSISTENCY_ONLY",
    basis,
    authenticity_verified: false,
    current_authority_verified: false,
    text_sv: LU_REEXECUTION_LEGACY_UNBOUND_FORM_TEXT_SV,
    finding_ids: [],
    detail,
  });
  if (!("capability_execution_ref" in outcome)) {
    return notice(
      "V1_FORM",
      `the pinned execution outcome ${pinnedOutcomeId} is a V1-format outcome without execution lineage: no output or ` +
        `execution-subject binding applies to it; consistency with the pinned artifacts only`,
    );
  }
  if (authority.kind === "bound" || subject.kind === "bound") return null;
  return notice(
    "LEGACY_UNBOUND",
    subject.kind === "unbound_accepted_in_test_bootstrap"
      ? `execution ${manifestId} has no governed subject and was accepted only because the verifying process is an explicit test bootstrap; consistency with the pinned artifacts only`
      : `no binding of execution ${manifestId} to a governed subject was established; consistency with the pinned artifacts only`,
  );
}

/**
 * The result of one binding check of verify (U30-R3 K2 authority subject, U30-R4 execution subject); U30-R6 reads
 * which bindings were positively established to decide the strength of a PASS.
 */
type LuReExecutionBindingCheck =
  | { readonly kind: "mismatch"; readonly mismatch: LuReExecutionMismatch }
  /** Every step of the binding was checked and holds. */
  | { readonly kind: "bound" }
  /** The binding does not apply to this assessment/outcome. */
  | { readonly kind: "not_applicable" }
  /** No governed subject to bind; accepted only because the verifying process is an explicit test bootstrap. */
  | { readonly kind: "unbound_accepted_in_test_bootstrap" };

const BOUND: LuReExecutionBindingCheck = { kind: "bound" };
const NOT_APPLICABLE: LuReExecutionBindingCheck = { kind: "not_applicable" };
const UNBOUND_ACCEPTED_IN_TEST_BOOTSTRAP: LuReExecutionBindingCheck = { kind: "unbound_accepted_in_test_bootstrap" };

/**
 * U30-R3 K2 -- `output_ids` (what the attested execution produced) against `freshIds` (what this
 * assessment's pinned evidence re-executes to), compared as sorted multisets. Only ids appear in the
 * detail, never finding text.
 */
function exactOutputBindingMismatch(
  executionId: string,
  outputIds: readonly string[],
  freshIds: readonly string[],
): LuReExecutionMismatch | null {
  const sortedOutputs = [...outputIds].sort();
  const sortedFresh = [...freshIds].sort();
  if (JSON.stringify(sortedOutputs) === JSON.stringify(sortedFresh)) return null;
  const remaining = [...sortedFresh];
  const onlyInOutputs: string[] = [];
  for (const id of sortedOutputs) {
    const at = remaining.indexOf(id);
    if (at === -1) onlyInOutputs.push(id);
    else remaining.splice(at, 1);
  }
  return {
    code: "MANIFEST_ATTEMPT_MISMATCH",
    detail:
      `attested execution lineage: CAPABILITY_EXECUTION ${executionId} output_refs are not exactly the findings ` +
      `re-executed from this assessment's pinned evidence (only in output_refs: ${JSON.stringify(onlyInOutputs)}; ` +
      `only re-executed: ${JSON.stringify(remaining)}) -- the pinned execution did not produce this assessment`,
  };
}

/**
 * U30-R3 K2 -- the reverse binding of a V4 assessment to the execution its outcome pins.
 *
 * assessment.authority_evidence_ref (inside the assessment's own hash) -> AuthorityEvidence, whose
 * pinned id must be re-derivable from its canonical fields -> exactly one `subject` path entry with
 * a pinned content hash -> that ExecutionIdentity, re-hashed (executionIdentityCanonicalBody) to the
 * pinned hash, carrying a V3 subject -> computeExecutionManifestIdV3(subject) must be the manifest the
 * outcome's attempt belongs to, and the subject's localization point must be the assessment's. Every
 * step is a hash or a preimage-resistant derivation; none trusts a stored claim, and no signature is
 * verified (that is authenticity, not consistency -- see the module header).
 *
 * Applies to V4 only: V1-V3 assessments pin no authority subject; over a v2 outcome they are bound to the
 * execution's subject by executionSubjectBinding (U30-R4) instead. Genuine absence of a pinned artifact is
 * MANIFEST_ATTEMPT_MISMATCH; a storage fault is LuReExecutionStorageError (OD-R2). U30-R6: "bound" only when every
 * step held, "not_applicable" when the assessment pins no authority evidence.
 */
async function authoritySubjectBinding(
  assessment: LocalizationAssessmentArtifact,
  manifestIdFromAttemptRef: string,
  repository: ArtifactRepositoryPort,
): Promise<LuReExecutionBindingCheck> {
  const evidenceRef = assessment.payload.authority_evidence_ref;
  if (evidenceRef === undefined) return NOT_APPLICABLE;
  const unbound = (detail: string): LuReExecutionBindingCheck => ({
    kind: "mismatch",
    mismatch: { code: "MANIFEST_ATTEMPT_MISMATCH", detail: `authority binding: ${detail}` },
  });

  const evidenceRead = await readPinnedArtifact<Record<string, unknown>>(repository, evidenceRef, "authority_evidence");
  if (evidenceRead.found === false) {
    return unbound(`authority evidence ${evidenceRef.artifact_id} pinned by the assessment is not in CAS`);
  }
  // The pinned id is derived from the evidence's canonical fields (createLuSourceAuthorityEvidence-
  // Artifact): recomputing it binds every field read below to the reference inside the assessment.
  const evidence = evidenceRead.value;
  const { artifact_id: _id, references: _references, content_hash: _hash, ...canonical } =
    typeof evidence === "object" && evidence !== null ? evidence : ({} as Record<string, unknown>);
  if (evidenceRef.artifact_id !== `authority-evidence-${sha256ContentHash(canonical).value.slice(0, 24)}`) {
    return unbound(`${evidenceRef.artifact_id} does not match its own content -- rewritten or malformed`);
  }

  const path = Array.isArray(canonical.authority_path) ? (canonical.authority_path as readonly unknown[]) : [];
  const subjects = path.filter((entry) => (entry as { role?: unknown } | null)?.role === "subject") as {
    readonly artifact_ref?: { readonly artifact_id?: unknown; readonly artifact_type?: unknown };
    readonly content_hash?: { readonly algorithm?: unknown; readonly value?: unknown };
  }[];
  const subjectEntry = subjects.length === 1 ? subjects[0]! : null;
  if (
    !subjectEntry ||
    typeof subjectEntry.artifact_ref?.artifact_id !== "string" ||
    typeof subjectEntry.artifact_ref?.artifact_type !== "string" ||
    typeof subjectEntry.content_hash?.value !== "string"
  ) {
    return unbound(`${evidenceRef.artifact_id} does not name exactly one authority subject`);
  }
  const subjectRef: ArtifactReference = {
    artifact_id: subjectEntry.artifact_ref.artifact_id,
    artifact_type: subjectEntry.artifact_ref.artifact_type,
  };

  const identityRead = await readPinnedArtifact<ExecutionIdentityArtifact>(repository, subjectRef, "execution_identity");
  if (identityRead.found === false) {
    return unbound(`execution identity ${subjectRef.artifact_id} named by the authority evidence is not in CAS`);
  }
  // The evidence pins the identity's content hash (executionIdentityCanonicalBody); its subject is
  // trusted only through that hash.
  const identity = typeof identityRead.value === "object" && identityRead.value !== null ? identityRead.value : null;
  const identityHash = identity ? sha256ContentHash(executionIdentityCanonicalBody(identity)) : null;
  if (
    identityHash?.algorithm !== subjectEntry.content_hash.algorithm ||
    identityHash?.value !== subjectEntry.content_hash.value
  ) {
    return unbound(`${subjectRef.artifact_id} is not the execution identity the authority evidence hashes`);
  }
  const subject = identity?.subject_v3;
  if (!subject) {
    return unbound(`${subjectRef.artifact_id} is not a V3 execution identity: it names no localization subject`);
  }

  if (computeExecutionManifestIdV3(subject) !== manifestIdFromAttemptRef) {
    return unbound(
      `the assessment's authority subject ${subjectRef.artifact_id} does not name the execution its outcome pins (manifest ${manifestIdFromAttemptRef})`,
    );
  }
  const point = assessment.payload.localization_geometry_ref;
  if (
    !point ||
    point.artifact_id !== subject.localization_geometry_ref?.artifact_id ||
    point.artifact_type !== subject.localization_geometry_ref?.artifact_type
  ) {
    return unbound(`the assessment's localization point is not the one its authority subject ${subjectRef.artifact_id} was issued for`);
  }
  return BOUND;
}

/** Every computeExecutionManifestIdV3 id has this prefix; legacy site-scoped and V2-scoped ids never derive from a V3 subject. */
const V3_SUBJECT_MANIFEST_PREFIX = "lu-manifest-v3-";

/**
 * U30-R4 -- the anti-downgrade binding for an assessment WITHOUT authority evidence (V1-V3), see the module
 * header. Applies only to a v2 outcome; a V4 assessment is bound by authoritySubjectBinding, and a V1
 * outcome (no lineage, before 2026-08-24) is historical and unchanged.
 *
 *  - V1/V2 label over a v2 outcome -> CONTRACT_DOWNGRADE_REFUSED (never produced: the V1/V2 producer is gone
 *    in the ancestor 33c19b58 of the v2 outcome d8b18cd9);
 *  - V3 over a v2 outcome: the attempt's manifest -> the execution identity it names -> that identity's
 *    `subject_v3`, which must derive the very manifest id (computeExecutionManifestIdV3; the id is
 *    preimage-bound to the subject, so no stored claim is trusted) -> the assessment's localization point
 *    must be the subject's. Any break is EXECUTION_SUBJECT_MISMATCH -- never excused by the bootstrap flag;
 *  - no governed subject to bind (a manifest not derived from a V3 subject, or an identity that is not in
 *    CAS: admitted under bootstrap, never issued) -> EXECUTION_SUBJECT_UNBOUND, unless the verifying
 *    process is an explicit dev/test bootstrap (isBootstrapExecutionReplayAllowed).
 * Genuine absence of the pinned manifest is MANIFEST_ATTEMPT_MISMATCH; a storage fault is
 * LuReExecutionStorageError (OD-R2). Details carry ids only. U30-R6: "bound" only when the subject binding held,
 * "not_applicable" for V4 and for a V1 outcome, "unbound_accepted_in_test_bootstrap" when the explicit test bootstrap
 * accepted an execution without a governed subject; EXECUTION_SUBJECT_UNBOUND carries its own Swedish text.
 */
async function executionSubjectBinding(
  assessment: LocalizationAssessmentArtifact,
  outcome: FrozenExecutionOutcomeIdentity,
  manifestRef: ArtifactReference,
  repository: ArtifactRepositoryPort,
  bootstrapExecutionsAllowed: boolean,
): Promise<LuReExecutionBindingCheck> {
  const declared = assessment.payload.assessment_contract_version;
  if (declared === LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V4) return NOT_APPLICABLE;
  if (!("capability_execution_ref" in outcome)) return NOT_APPLICABLE;

  if (declared !== LOCALIZATION_ASSESSMENT_CONTRACT_VERSION_V3) {
    return {
      kind: "mismatch",
      mismatch: {
        code: "CONTRACT_DOWNGRADE_REFUSED",
        detail:
          `assessment declares ${declared ?? "no contract version (V1)"} but pins the v2 execution outcome ` +
          `${assessment.payload.execution_outcome_ref.artifact_id}; every v2 outcome postdates the V1/V2 assessment contracts`,
      },
    };
  }

  const manifestId = manifestRef.artifact_id;
  const unbound = (detail: string): LuReExecutionBindingCheck =>
    bootstrapExecutionsAllowed
      ? UNBOUND_ACCEPTED_IN_TEST_BOOTSTRAP
      : {
          kind: "mismatch",
          mismatch: {
            code: "EXECUTION_SUBJECT_UNBOUND",
            detail: `execution subject binding: ${detail}`,
            text_sv: LU_REEXECUTION_UNBOUND_TEXT_SV,
          },
        };
  const mismatch = (detail: string): LuReExecutionBindingCheck => ({
    kind: "mismatch",
    mismatch: { code: "EXECUTION_SUBJECT_MISMATCH", detail: `execution subject binding: ${detail}` },
  });

  if (!manifestId.startsWith(V3_SUBJECT_MANIFEST_PREFIX)) {
    return unbound(`manifest ${manifestId} is not derived from a canonical V3 subject (a legacy execution of the general engine)`);
  }
  const manifestRead = await readPinnedArtifact<{ readonly execution_identity_ref?: unknown }>(repository, manifestRef, "execution_manifest");
  if (manifestRead.found === false) {
    return {
      kind: "mismatch",
      mismatch: { code: "MANIFEST_ATTEMPT_MISMATCH", detail: `execution manifest ${manifestId} pinned by the attempt is not in CAS` },
    };
  }
  const named = (typeof manifestRead.value === "object" && manifestRead.value !== null
    ? manifestRead.value.execution_identity_ref
    : undefined) as { readonly artifact_id?: unknown; readonly artifact_type?: unknown } | null | undefined;
  if (typeof named?.artifact_id !== "string" || typeof named?.artifact_type !== "string") {
    return mismatch(`manifest ${manifestId} names no execution identity`);
  }
  const identityRef: ArtifactReference = { artifact_id: named.artifact_id, artifact_type: named.artifact_type };

  const identityRead = await readPinnedArtifact<Record<string, unknown>>(repository, identityRef, "execution_identity");
  if (identityRead.found === false) {
    return unbound(`execution identity ${identityRef.artifact_id} named by manifest ${manifestId} is not in CAS (admitted under bootstrap, never issued)`);
  }
  const identity = identityRead.value;
  const subject = (typeof identity === "object" && identity !== null ? identity.subject_v3 : undefined) as
    | ExecutionIdentitySubjectV3
    | null
    | undefined;
  if (typeof subject !== "object" || subject === null || computeExecutionManifestIdV3(subject) !== manifestId) {
    return mismatch(`execution identity ${identityRef.artifact_id} does not carry the V3 subject manifest ${manifestId} was derived from`);
  }

  const point = assessment.payload.localization_geometry_ref;
  if (
    !point ||
    point.artifact_id !== subject.localization_geometry_ref?.artifact_id ||
    point.artifact_type !== subject.localization_geometry_ref?.artifact_type
  ) {
    return mismatch(`the assessment's localization point is not the one execution ${manifestId} was run for`);
  }
  return BOUND;
}

/**
 * U30-R2 -- the governed layers the ATTESTED execution reported as not checked; U30-R3 K2 -- and every
 * finding id it produced (`output_ids`, null for a V1 outcome without lineage).
 *
 * Source: the assessment's execution_outcome_ref (a FrozenExecutionOutcome v2, validated above)
 * -> its capability_execution_ref -> the CAPABILITY_EXECUTION the kernel wrote when the rules ran
 * -> its output_refs, i.e. the finding ids that execution produced; `finding-notchecked-<layer>`
 * names a layer the run could not check. The record is re-hashed from its own outputs and the
 * pinned capability definition's implementation id -- the formula CapabilityRuntime.execute
 * (packages/mps-runtime/src/capability/CapabilityRuntime.ts) uses -- and its id must carry that
 * hash, so a rewritten output list is detected instead of trusted. Missing or inconsistent lineage
 * is MANIFEST_ATTEMPT_MISMATCH: the pinned execution chain cannot be trusted.
 *
 * Deliberately NOT sources:
 *  - the stored findings under comparison: circular -- an added NOT_CHECKED would "reproduce"
 *    itself;
 *  - "governed layers in code minus layers with pinned SpatialEvidence": the requested layer set
 *    is pinned nowhere per assessment (the manifest pins site_id + seed only), so that difference
 *    would invent NOT_CHECKED findings for layers a run never asked for (single-layer runs,
 *    assessments from before LU-BREADTH-01).
 *
 * A V1 outcome carries no capability lineage. V1 predates NOT_CHECKED (SEM-1) by a month, so it
 * attests none: nothing is fed back, exactly as before U30-R2, and there is no output list to bind.
 */
async function attestedExecution(
  outcome: FrozenExecutionOutcomeIdentity,
  repository: ArtifactRepositoryPort,
): Promise<
  | {
      readonly layers: readonly string[];
      readonly execution_id: string;
      readonly output_ids: readonly string[] | null;
    }
  | { readonly mismatch: LuReExecutionMismatch }
> {
  if (!("capability_execution_ref" in outcome)) {
    return { layers: [], execution_id: "", output_ids: null };
  }
  const untrusted = (detail: string) => ({
    mismatch: { code: "MANIFEST_ATTEMPT_MISMATCH" as const, detail: `attested execution lineage: ${detail}` },
  });
  const executionRef = outcome.capability_execution_ref;

  // OD-R2: only "never stored" is a verdict about the lineage; a storage/index fault is the typed
  // technical error (LuReExecutionStorageError) instead of a DENY.
  const executionRead = await readPinnedArtifact<FrozenCapabilityExecutionArtifact>(repository, executionRef, "capability_execution");
  if (!executionRead.found) {
    return untrusted(`CAPABILITY_EXECUTION ${executionRef.artifact_id} pinned by the outcome is not in CAS`);
  }
  const execution = executionRead.value;
  if (
    !execution ||
    execution.artifact_type !== "CAPABILITY_EXECUTION" ||
    execution.artifact_id !== executionRef.artifact_id ||
    !Array.isArray(execution.output_refs) ||
    typeof execution.capability_ref?.artifact_id !== "string"
  ) {
    return untrusted(`${executionRef.artifact_id} is not the CAPABILITY_EXECUTION the outcome pins`);
  }

  const capabilityRead = await readPinnedArtifact<{
    readonly artifact_id?: unknown;
    readonly implementation_ref?: { readonly artifact_id?: unknown };
  }>(repository, execution.capability_ref, "capability_definition");
  if (!capabilityRead.found) {
    return untrusted(`capability definition ${execution.capability_ref.artifact_id} is not in CAS`);
  }
  const capability = capabilityRead.value;
  const implementationId = capability?.implementation_ref?.artifact_id;
  if (capability?.artifact_id !== execution.capability_ref.artifact_id || typeof implementationId !== "string" || implementationId.length === 0) {
    return untrusted(`capability definition ${execution.capability_ref.artifact_id} does not name an implementation`);
  }

  const outputIds = execution.output_refs.map((ref) => ref?.artifact_id);
  if (outputIds.some((id) => typeof id !== "string")) {
    return untrusted(`${executionRef.artifact_id} has a malformed output_refs entry`);
  }
  const recomputed = sha256ContentHash({
    capability: execution.capability_ref.artifact_id,
    implementation: implementationId,
    outputs: outputIds,
  });
  if (
    recomputed.value !== execution.content_hash?.value ||
    execution.artifact_id !== `exec-${execution.capability_ref.artifact_id}-${recomputed.value.slice(0, 12)}`
  ) {
    return untrusted(`${executionRef.artifact_id} does not match its own outputs (recomputed ${recomputed.value}) -- rewritten or malformed`);
  }

  return {
    layers: (outputIds as string[])
      .filter((id) => id.startsWith(NOT_CHECKED_FINDING_ID_PREFIX))
      .map((id) => id.slice(NOT_CHECKED_FINDING_ID_PREFIX.length)),
    execution_id: execution.artifact_id,
    output_ids: outputIds as string[],
  };
}

/**
 * U30-R3 K1 (OD-R2) -- the repository DefaultReplayEngine reads through during category A. A genuine
 * absence passes through unchanged (the engine's own verdict on a broken chain); every other read or
 * write failure becomes LuReExecutionStorageError and is RECORDED, because the engine deliberately
 * swallows one read (the v2-outcome locator: absent means a historical V1 execution) and must not be
 * able to swallow a storage fault with it. The caller rethrows the first recorded fault.
 */
function classifyingReplayRepository(inner: ArtifactRepositoryPort): {
  readonly repository: ArtifactRepositoryPort;
  readonly faults: LuReExecutionStorageError[];
} {
  const faults: LuReExecutionStorageError[] = [];
  const stageOf = (artifactType: string): LuReExecutionStage =>
    artifactType === "execution_attempt"
      ? "execution_attempt"
      : artifactType === "execution_manifest"
      ? "execution_manifest"
      : artifactType === "execution_outcome"
      ? "execution_outcome"
      : "replay_chain";
  return {
    faults,
    repository: {
      async resolve<T>(ref: ArtifactReference): Promise<T> {
        try {
          return await inner.resolve<T>(ref);
        } catch (error) {
          if (isArtifactNotFound(error, ref.artifact_id)) throw error;
          const fault =
            error instanceof LuReExecutionStorageError
              ? error
              : new LuReExecutionStorageError(stageOf(ref.artifact_type), ref, "resolve", { cause: error });
          faults.push(fault);
          throw fault;
        }
      },
      async put(artifact) {
        try {
          await inner.put(artifact);
        } catch (error) {
          const fault =
            error instanceof LuReExecutionStorageError
              ? error
              : new LuReExecutionStorageError(
                  "replay_record",
                  { artifact_id: artifact.artifact_id, artifact_type: "REPLAY" },
                  "put",
                  { cause: error },
                );
          faults.push(fault);
          throw fault;
        }
      },
    },
  };
}

/**
 * U30-R2: `stored` is the historical form of the reproduced NOT_CHECKED finding `fresh` -- equal in
 * every field except the explanation, which has the pre-U30-R2 frame around a provider text.
 */
function isHistoricalNotCheckedWordingOf(stored: AssessmentFinding, fresh: AssessmentFinding): boolean {
  if (fresh.risk_level !== "NOT_CHECKED" || !fresh.finding_id.startsWith(NOT_CHECKED_FINDING_ID_PREFIX)) {
    return false;
  }
  const dataset = fresh.finding_id.slice(NOT_CHECKED_FINDING_ID_PREFIX.length);
  return (
    stored.finding_id === fresh.finding_id &&
    stored.rule_id === fresh.rule_id &&
    stored.rule_version === fresh.rule_version &&
    stored.risk_level === fresh.risk_level &&
    Array.isArray(stored.evidence_refs) &&
    JSON.stringify(stored.evidence_refs) === JSON.stringify(fresh.evidence_refs) &&
    typeof stored.explanation === "string" &&
    stored.explanation !== fresh.explanation &&
    isHistoricalNotCheckedExplanation(stored.explanation, dataset)
  );
}

function deriveManifestIdFromAttemptId(attemptId: string): string {
  const match = /^attempt-(.+)-1$/.exec(attemptId);
  if (!match) {
    throw new Error(`REJECT_REEXECUTION: attempt_id "${attemptId}" does not match the expected attempt-\${manifest_id}-1 shape`);
  }
  return match[1]!;
}
