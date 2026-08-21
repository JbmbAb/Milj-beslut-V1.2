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
 * `createdAt` is NEVER used to decide validity. It is only the final deterministic tiebreaker
 * among candidates that have ALREADY passed both current-binding eligibility and CAS
 * re-verification -- selection order is: eligibility (bound to the current head) -> CAS
 * re-verification (exists, correct type, untampered, project_context_ref matches the row) ->
 * only then, among what remains, most recent first.
 */
import type { ArtifactRepositoryPort } from "@miljobeslut/mps-runtime";
import { sha256ContentHash } from "@miljobeslut/mps-compliance/src/canonical/sha256Canonical";
import {
  localizationAssessmentCanonicalBody,
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
  });
}

export interface CurrentAssessmentProjection {
  readonly assessmentArtifactId: string;
}

/**
 * Selection order (frozen): load candidates -> resolveCurrent(projectId) via the verified
 * ProjectContextBinding graph -> retain only rows bound to that exact current head -> for each
 * remaining candidate (most recent first), re-resolve and re-verify it against CAS, rejecting and
 * moving to the next candidate on any failure -> return the first candidate that survives.
 */
export async function resolveCurrentAssessmentProjection(args: {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly currentBindingProvider: ProjectContextBindingProvider;
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

  const eligible = candidates
    .filter((c) => c.projectId === args.projectId && c.bindingArtifactId === currentBinding.artifact_id)
    // createdAt is the tiebreaker only, applied here -- after eligibility, before CAS re-verification.
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (eligible.length === 0) {
    throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_CURRENT: no candidate bound to the current ProjectContextBinding");
  }

  for (const candidate of eligible) {
    if (candidate.assessmentArtifactType !== "LOCALIZATION_ASSESSMENT") continue;

    let assessment: LocalizationAssessmentArtifact;
    try {
      assessment = await args.artifactRepository.resolve<LocalizationAssessmentArtifact>({
        artifact_id: candidate.assessmentArtifactId,
        artifact_type: "LOCALIZATION_ASSESSMENT",
      });
    } catch {
      continue; // missing CAS object -> reject this candidate, try the next
    }

    const recomputed = sha256ContentHash(localizationAssessmentCanonicalBody(assessment));
    const untampered =
      sameHash(assessment.content_hash, recomputed) &&
      assessment.artifact_id === `assessment-${recomputed.value}`;
    if (!untampered) continue; // tampered/wrong artifact -> reject this candidate

    if (
      !sameRef(assessment.payload.project_context_ref, {
        artifact_id: candidate.projectContextRefId,
        artifact_type: candidate.projectContextRefType,
      })
    ) {
      continue; // projection row claims a context this artifact does not actually carry -> reject
    }

    // "verify release binding if the assessment contract carries it": LocalizationAssessmentPayload
    // (packages/mps-lu/src/artifacts/LocalizationAssessmentArtifact.ts) has no release-ref field
    // today, so there is nothing further to check here -- not a gap, just not part of this
    // artifact's current contract.

    return { assessmentArtifactId: assessment.artifact_id };
  }

  throw new Error("REJECT_ASSESSMENT_PROJECTION_NOT_FOUND: no candidate for the current binding survived CAS re-verification");
}
