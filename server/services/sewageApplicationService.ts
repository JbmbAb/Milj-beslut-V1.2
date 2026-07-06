/**
 * Sewage Application Service (Legacy wrapper)
 * Delegating core logic to Clean Architecture Use Case in src/application/
 */

import type {
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
} from '../../types';
import {
  AssessSewageApplicationUseCase,
  type CreateSewageApplicationInput,
} from '../../src/application/assess-sewage-application.usecase';
import {
  updateSewageApplicationRecord,
  type SewageApplicationRecord,
} from '../repositories/sewageApplicationRepository';

const useCase = new AssessSewageApplicationUseCase();

export async function createSewageApplication(
  request: CreateSewageApplicationInput,
): Promise<SewageApplicationRecord> {
  return useCase.create(request);
}

export async function updateSoilTestResults(
  applicationId: string,
  ltar: number,
  testDate: string,
): Promise<SewageApplicationRecord | null> {
  const result = await useCase.recordSoilTest(applicationId, { ltar, testDate });
  return result.ok ? result.application : null;
}

export async function recordNeighborConsent(
  applicationId: string,
  address: string,
  distance: number,
  obtained: boolean = true,
): Promise<SewageApplicationRecord | null> {
  const result = await useCase.recordNeighborConsent(applicationId, { address, distance, obtained });
  return result.ok ? result.application : null;
}

export async function changeSewageSystem(
  applicationId: string,
  newSystemType: SewageSystemTypeId,
  protectionProfile: SewageProtectionProfile,
): Promise<SewageApplicationRecord | null> {
  return updateSewageApplicationRecord(applicationId, {
    systemType: newSystemType,
    domainSnapshot: { protectionProfile },
  });
}

export async function validateApplicationForSubmission(
  applicationId: string,
): Promise<{
  canSubmit: boolean;
  blockers: string[];
  warnings: string[];
}> {
  return useCase.validateForSubmission(applicationId);
}

export async function submitApplicationToMunicipality(
  applicationId: string,
  municipalityCode: string,
): Promise<{
  success: boolean;
  submissionId?: string;
  referenceNumber?: string;
  estimatedProcessingTime?: number; // weeks
  error?: string;
}> {
  const result = await useCase.submit(
    applicationId,
    { id: 'legacy-system', organisationId: 'legacy-org', role: 'LEGACY' },
    { municipalityCode },
  );

  if (result.ok) {
    return {
      success: true,
      submissionId: `submission-${result.referenceNumber}`,
      referenceNumber: result.referenceNumber,
      estimatedProcessingTime: result.estimatedProcessingWeeks,
    };
  } else {
    let errorMsg = (result as any).message || (result as any).error || 'Submission failed';
    if ((result as any).error === 'not_found') {
      errorMsg = 'not found';
    }
    return {
      success: false,
      error: errorMsg,
    };
  }
}
