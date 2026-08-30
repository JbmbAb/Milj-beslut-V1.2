import type { ArtifactRepositoryPort } from '@miljobeslut/mps-runtime';
import type { ArtifactReference } from '@miljobeslut/mps-compliance/src/artifacts/ArtifactReference';
import {
  reconcileAssessmentProjection,
  type AssessmentProjectionReconciliationResult,
} from './assessmentProjection';
import type { ProjectAssessmentProjectionIndex } from '../../repositories/projectAssessmentProjectionRepository';
import {
  PrismaAssessmentProjectionReconciliationStore,
  type AssessmentProjectionReconciliationObligation,
  type AssessmentProjectionReconciliationStore,
} from '../../repositories/assessmentProjectionReconciliationRepository';

export interface AssessmentProjectionReconciliationContext {
  readonly projectId: string;
  readonly artifactRepository: ArtifactRepositoryPort;
  readonly currentProjectContextRef: ArtifactReference;
  readonly currentBindingRef: ArtifactReference;
  readonly currentReleaseRef: ArtifactReference;
  readonly currentLocalizationGeometryArtifactId?: string;
  readonly projectionIndex?: ProjectAssessmentProjectionIndex;
  readonly obligationStore?: AssessmentProjectionReconciliationStore;
}

export interface AssessmentProjectionReconciliationSweepResult {
  readonly attempted: number;
  readonly reconciled: number;
  readonly notCurrent: number;
  readonly missingCas: number;
  readonly tampered: number;
  readonly retryableFailures: number;
}

type AssessmentProjectionReconciliationFailureReason = Extract<
  AssessmentProjectionReconciliationResult,
  { readonly reconciled: false }
>['reason'];

function isAuthorityDenial(reason: AssessmentProjectionReconciliationFailureReason): boolean {
  return (
    reason === 'TAMPERED_CAS_ARTIFACT' || reason === 'WRONG_TYPE' || reason === 'UNKNOWN_CONTRACT_VERSION'
  );
}

export async function reconcileOneAssessmentProjectionObligation(
  obligation: AssessmentProjectionReconciliationObligation,
  context: AssessmentProjectionReconciliationContext,
): Promise<AssessmentProjectionReconciliationResult> {
  const store = context.obligationStore ?? new PrismaAssessmentProjectionReconciliationStore();
  try {
    const result = await reconcileAssessmentProjection({
      projectId: context.projectId,
      assessmentArtifactId: obligation.assessmentArtifactId,
      artifactRepository: context.artifactRepository,
      currentProjectContextRef: context.currentProjectContextRef,
      currentBindingRef: context.currentBindingRef,
      currentReleaseRef: context.currentReleaseRef,
      currentLocalizationGeometryArtifactId: context.currentLocalizationGeometryArtifactId,
      index: context.projectionIndex,
    });

    if (result.reconciled) {
      await store.markReconciled(obligation.assessmentArtifactId);
      return result;
    }
    if (result.reason === 'MISSING_CAS_ARTIFACT') {
      await store.markMissingCas(obligation.assessmentArtifactId);
      return result;
    }
    if (result.reason === 'NOT_CURRENT') {
      await store.markNotCurrent(obligation.assessmentArtifactId);
      return result;
    }
    if (isAuthorityDenial(result.reason)) {
      await store.markTampered(obligation.assessmentArtifactId, result.reason);
      return result;
    }
    await store.recordRetryableFailure(obligation.assessmentArtifactId, result.reason);
    return result;
  } catch (error) {
    await store.recordRetryableFailure(
      obligation.assessmentArtifactId,
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export async function reconcileAssessmentProjectionObligationsForProject(
  context: AssessmentProjectionReconciliationContext,
): Promise<AssessmentProjectionReconciliationSweepResult> {
  const store = context.obligationStore ?? new PrismaAssessmentProjectionReconciliationStore();
  const obligations = await store.listRecoverableForProject(context.projectId);
  const result: {
    attempted: number;
    reconciled: number;
    notCurrent: number;
    missingCas: number;
    tampered: number;
    retryableFailures: number;
  } = {
    attempted: 0,
    reconciled: 0,
    notCurrent: 0,
    missingCas: 0,
    tampered: 0,
    retryableFailures: 0,
  };

  for (const obligation of obligations) {
    result.attempted += 1;
    try {
      const one = await reconcileOneAssessmentProjectionObligation(obligation, context);
      if (one.reconciled) result.reconciled += 1;
      else if (one.reason === 'NOT_CURRENT') result.notCurrent += 1;
      else if (one.reason === 'MISSING_CAS_ARTIFACT') result.missingCas += 1;
      else if (isAuthorityDenial(one.reason)) result.tampered += 1;
      else result.retryableFailures += 1;
    } catch {
      result.retryableFailures += 1;
    }
  }

  return result;
}
