/**
 * P3-LU-ASSESSMENT-CURRENT-PROJECTION-01.
 *
 * A durable, non-authoritative locator: "which already-persisted LocalizationAssessmentArtifact
 * is current for this project's current ProjectContextBinding." CAS remains the sole content
 * authority -- registerAssessmentProjection only ever records a pointer to an artifact that has
 * already been persisted (by GovernedAssessmentPersistence, elsewhere); resolveCurrentAssessmentProjection
 * never trusts a projection row's own claims and re-resolves + re-verifies every candidate against
 * CAS before selecting it.
 *
 * Projection registration time is operational bookkeeping, never current-state authority.
 * Selection is: eligibility (bound to the current head) -> CAS re-verification (exists, correct
 * type, untampered, project_context_ref matches the row) -> exactly one verified survivor. More
 * than one semantically distinct verified survivor is an unresolved authority conflict and fails
 * closed until an explicit signed assessment-current/supersession relation exists.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import {
  localizationAssessmentCanonicalBody,
  validateLocalizationAssessmentContractVersion,
  type LocalizationAssessmentArtifact,
} from "@miljobeslut/mps-lu";
import type { ArtifactReference } from "@miljobeslut/mps-compliance/src/artifacts/ArtifactReference";
import {
  PrismaProjectAssessmentProjectionIndex,
  type ProjectAssessmentProjectionIndex,
} from "../../repositories/projectAssessmentProjectionRepository.js";
import { ProjectContextBindingProvider } from "./projectContextBindingRuntime.js";

function sameHash(
  left: { readonly algorithm: string; readonly value: string },
  right: { readonly algorithm: string; readonly value: string },
): boolean {
  return left.algorithm === right.algorithm && left.value === right.value;
}

function sameRef(left: ArtifactReference, right: ArtifactReference): boolean {
  return left.artifact_id === right.artifact_id && left.artifact_type === right.artifact_type;
}

/**
 * Called from the real write path (generate-localization-report.usecase.ts) right after a
 * successful kernel run, never from the generic kernel client -- this keeps product-specific
 * persistence out of the generic governed execution chain. Idempotent: an identical re-run
 * produces the identical (content-addressed) assessment artifact_id, so re-registering it is a
 * harmless no-op (`ON CONFLICT DO NOTHING`), not a duplicate row.
 */
export async function registerAssessmentProjection(args: {
  readonly projectId: string;
  readonly assessment: LocalizationAssessmentArtifact;
  readonly contextBindingRef: ArtifactReference;
  readonly releaseRef: ArtifactReference;
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. The current LocalizationGeometryArtifact this assessment
   * was produced for. Optional so a caller with no explicit geometry yet (pre-Phase-B / legacy
   * path) still registers -- but see resolveCurrentAssessmentProjection: a row with this unset can
   * never satisfy a caller that requires current-geometry eligibility.
   */
  readonly localizationGeometryArtifactId?: string;
  readonly index?: ProjectAssessmentProjectionIndex;
}): Promise<void> {
  const index = args.index ?? new PrismaProjectAssessmentProjectionIndex();
  await index.register({
    projectId: args.projectId,
    assessmentArtifactId: args.assessment.artifact_id,
    assessmentArtifactType: args.assessment.artifact_type,
    projectContextRef: args.assessment.payload.project_context_ref,
    bindingArtifactId: args.contextBindingRef.artifact_id,
    releaseArtifactId: args.releaseRef.artifact_id,
    localizationGeometryArtifactId: args.localizationGeometryArtifactId ?? null,
  });
}

export interface CurrentAssessmentProjection {
  readonly assessmentArtifactId: string;
}

/**
 * Selection order (frozen, LU-PROJECTION-RECONCILIATION-AND-TOTAL-ORDER-V1 Phase B): load
 * candidates -> resolveCurrent(projectId) via the verified ProjectContextBinding graph -> retain
 * only rows bound to that exact current head (and current geometry, if supplied) -> re-resolve and
 * re-verify EVERY remaining candidate against CAS (never short-circuit) -> require exactly one
 * verified survivor. More than one verified survivor fails closed
 * (REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT); registration order, row order, and createdAt
 * are never a tiebreaker.
 */
export async function resolveCurrentAssessmentProjection(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly currentBindingProvider: ProjectContextBindingProvider;
  /**
   * PRODUCT-LU-LOCALIZATION-GEOMETRY-01. When provided, eligibility ALSO requires the candidate's
   * `localizationGeometryArtifactId` to equal this -- current-assessment resolution then means
   * "current binding AND current localization point", not binding alone. A moved-away-from point's
   * assessment (still bound to the current binding) is excluded rather than wrongly selected as
   * current. Omitted by callers for a project with no localization geometry yet (legacy/pre-Phase-B):
   * behavior is then unchanged (binding-only eligibility), so existing projects are not broken by
   * this addition.
   */
  readonly currentLocalizationGeometryArtifactId?: string;
  readonly index?: ProjectAssessmentProjectionIndex;
}): Promise<CurrentAssessmentProjection> {
  const index = args.index ?? new PrismaProjectAssessmentProjectionIndex();
  const candidates = await index.listForProject(args.projectId);
  if (candidates.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no assessment projection for project");
  }

  let currentBinding: { readonly artifact_id: string };
  try {
    currentBinding = await args.currentBindingProvider.resolveCurrent(args.projectId);
  } catch {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: current binding unavailable");
  }

  const eligible = candidates.filter(
    (c) =>
      c.projectId === args.projectId &&
      c.bindingArtifactId === currentBinding.artifact_id &&
      (args.currentLocalizationGeometryArtifactId === undefined ||
        c.localizationGeometryArtifactId === args.currentLocalizationGeometryArtifactId),
  );
  if (eligible.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT: no candidate bound to the current ProjectContextBinding and localization geometry");
  }

  // Verify EVERY eligible candidate against CAS first (never short-circuit on the first pass).
  // The ambiguity check applies only to genuine verified survivors, so a tampered/orphaned row
  // cannot manufacture a false conflict. createdAt remains operational projection metadata only.
  const verified: LocalizationAssessmentArtifact[] = [];
  for (const candidate of eligible) {
    if (candidate.assessmentArtifactType !== "LOCALIZATION_ASSESSMENT") continue;

    let assessment: LocalizationAssessmentArtifact;
    try {
      assessment = await args.artifactRepository.resolve<LocalizationAssessmentArtifact>({
        artifact_id: candidate.assessmentArtifactId,
        artifact_type: "LOCALIZATION_ASSESSMENT",
      });
    } catch {
      continue; // missing CAS object -> reject this candidate
    }

    const recomputed = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
    const untampered =
      sameHash(assessment.content_hash, recomputed) &&
      assessment.artifact_id === `assessment-${recomputed.value}`;
    if (!untampered) continue; // tampered/wrong artifact -> reject this candidate

    // H2/H12: explicit version dispatch -- absent version = legacy V1 shape (no extra rules
    // beyond the hash check above); V2 marker = V2 structural rules (canonicalizer_id, canonical
    // evidence_refs); anything else fails closed. Not swallowed into "reject this candidate" --
    // an unknown contract version is a hard error, not a benign missing-CAS-object situation.
    validateLocalizationAssessmentContractVersion(assessment.payload);

    if (
      !sameRef(assessment.payload.project_context_ref, {
        artifact_id: candidate.projectContextRefId,
        artifact_type: candidate.projectContextRefType,
      })
    ) {
      continue; // projection row claims a context this artifact does not actually carry -> reject
    }

    if (
      args.currentLocalizationGeometryArtifactId !== undefined &&
      assessment.payload.localization_geometry_ref?.artifact_id !== args.currentLocalizationGeometryArtifactId
    ) {
      // The row passed the earlier filter, but the CAS artifact's own claim disagrees (or is
      // absent) -- reject rather than trust the projection row's unverified column.
      continue;
    }

    // "verify release binding if the assessment contract carries it": LocalizationAssessmentPayload
    // (packages/mps-lu/src/artifacts/LocalizationAssessmentArtifact.ts) has no release-ref field
    // today, so there is nothing further to check here -- not a gap, just not part of this
    // artifact's current contract.

    verified.push(assessment);
  }

  if (verified.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no candidate for the current binding survived CAS re-verification");
  }

  if (verified.length > 1) {
    // More than one genuinely distinct, independently verified assessment for the same current
    // binding/geometry has no declared semantic currentness relation. Do not let projection
    // registration/rebuild order, row order, timestamps, or artifact ids invent one.
    throw new Error(
      "REJECT_ASSESSMENT_PROJECTION_AMBIGUOUS_CURRENT: multiple verified assessment candidates for the current binding/geometry",
    );
  }

  return { assessmentArtifactId: verified[0]!.artifact_id };
}

export type AssessmentProjectionReconciliationResult =
  | { readonly reconciled: true }
  | { readonly reconciled: false; readonly reason: "MISSING_CAS_ARTIFACT" | "TAMPERED_CAS_ARTIFACT" | "WRONG_TYPE" | "NOT_CURRENT" | "UNKNOWN_CONTRACT_VERSION" };

/**
 * P3-LU-ASSESSMENT-PROJECTION-RELIABILITY-01.
 *
 * Deterministic, idempotent recovery for a known write-path failure
 * (assessment_projection_registered === false on a real report response, or an operator
 * rebuilding the whole projection from CAS + known assessment refs). Never resolves the current
 * canonical context itself -- that would create a dependency from server/modules/localization
 * (this file) back onto src/application (resolveCanonicalProjectContext.ts / resolveCurrentProductRelease.ts),
 * which already depend on server/modules/localization the other way. The caller resolves "what is
 * current right now" first (the same way the original write path did) and passes it in here.
 *
 * Refuses to reconcile (returns `NOT_CURRENT`, never throws for this case) when the assessment's
 * own `project_context_ref` does not match the caller-supplied current canonical context -- this
 * is what makes "wrong project/binding cannot be repaired into current state" true: an assessment
 * genuinely computed under a since-superseded context stays historical, never silently promoted.
 *
 * Does NOT catch a projection-store failure (e.g. `index.register` throwing because the
 * projection DB is unavailable) -- that propagates to the caller so it is observable, not
 * logger-only.
 */
export async function reconcileAssessmentProjection(args: {
  readonly projectId: string;
  readonly assessmentArtifactId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly currentProjectContextRef: ArtifactReference;
  readonly currentBindingRef: ArtifactReference;
  readonly currentReleaseRef: ArtifactReference;
  readonly index?: ProjectAssessmentProjectionIndex;
}): Promise<AssessmentProjectionReconciliationResult> {
  let assessment: LocalizationAssessmentArtifact;
  try {
    assessment = await args.artifactRepository.resolve<LocalizationAssessmentArtifact>({
      artifact_id: args.assessmentArtifactId,
      artifact_type: "LOCALIZATION_ASSESSMENT",
    });
  } catch {
    return { reconciled: false, reason: "MISSING_CAS_ARTIFACT" };
  }

  if (assessment.artifact_type !== "LOCALIZATION_ASSESSMENT") {
    return { reconciled: false, reason: "WRONG_TYPE" };
  }

  const recomputed = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
  const untampered =
    sameHash(assessment.content_hash, recomputed) &&
    assessment.artifact_id === `assessment-${recomputed.value}`;
  if (!untampered) {
    return { reconciled: false, reason: "TAMPERED_CAS_ARTIFACT" };
  }

  // H2/H12: explicit version dispatch, same rule as resolveCurrentAssessmentProjection above --
  // never silently reconcile an artifact carrying an unrecognized contract version.
  try {
    validateLocalizationAssessmentContractVersion(assessment.payload);
  } catch {
    return { reconciled: false, reason: "UNKNOWN_CONTRACT_VERSION" };
  }

  if (!sameRef(assessment.payload.project_context_ref, args.currentProjectContextRef)) {
    // Genuinely valid, CAS-verified evidence -- just not for the CURRENT canonical state anymore
    // (the project's binding moved on since this assessment was computed). Historical, not current.
    return { reconciled: false, reason: "NOT_CURRENT" };
  }

  const index = args.index ?? new PrismaProjectAssessmentProjectionIndex();
  // Propagates on failure -- a caller (ops reconciliation run) must see this, not have it
  // swallowed a second time.
  await index.register({
    projectId: args.projectId,
    assessmentArtifactId: assessment.artifact_id,
    assessmentArtifactType: assessment.artifact_type,
    projectContextRef: assessment.payload.project_context_ref,
    bindingArtifactId: args.currentBindingRef.artifact_id,
    releaseArtifactId: args.currentReleaseRef.artifact_id,
  });
  return { reconciled: true };
}
