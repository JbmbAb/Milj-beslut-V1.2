/**
 * Orkestrering av enskilt-avlopp-flödet: delegating to Clean Architecture Use Cases.
 */

import type {
  SewageApplication,
  SewageGISAnalysis,
  SewageProtectionProfile,
} from '../../../types';
import {
  AssessSewageApplicationUseCase,
  resolveDomainContext as ucResolveDomainContext,
  recordStatusToDomain as ucRecordStatusToDomain,
} from '../../../src/application/assess-sewage-application.usecase';
import type { OrchestratorAuth } from '../../../src/application/assess-sewage-application.usecase';
export type { OrchestratorAuth };

const useCase = new AssessSewageApplicationUseCase();

export { ucRecordStatusToDomain as recordStatusToDomain };

export function resolveDomainContext(
  record: any,
  body?: any,
): {
  application: SewageApplication;
  protectionProfile: SewageProtectionProfile;
  gisAnalysis: SewageGISAnalysis;
  warnings: string[];
} {
  return ucResolveDomainContext(record, body);
}

export async function validateSewageApplication(
  applicationId: string,
  body?: {
    application?: Partial<SewageApplication>;
    protectionProfile?: SewageProtectionProfile;
    gisAnalysis?: SewageGISAnalysis;
  },
) {
  return useCase.validate(applicationId, body);
}

export async function generateDocumentsForApplication(
  applicationId: string,
  body?: {
    application?: Partial<SewageApplication>;
    protectionProfile?: SewageProtectionProfile;
    gisAnalysis?: SewageGISAnalysis;
  },
) {
  return useCase.generateDocuments(applicationId, body);
}

export async function submitSewageApplication(
  applicationId: string,
  auth: OrchestratorAuth,
  body: {
    municipalityCode: string;
    projectId?: string;
    application?: Partial<SewageApplication>;
    protectionProfile?: SewageProtectionProfile;
    gisAnalysis?: SewageGISAnalysis;
    situationPlanSVG?: string;
    crossSectionSVG?: string;
  },
) {
  return useCase.submit(applicationId, auth, body);
}

export async function getApplicationStatusHistory(applicationId: string) {
  return useCase.getStatusHistory(applicationId);
}

export async function getApplicationAuditTrail(applicationId: string) {
  return useCase.getAuditTrail(applicationId);
}

export async function patchApplicationDraft(
  applicationId: string,
  patch: Partial<{
    propertyDesignation: string;
    latitude: number;
    longitude: number;
    applicantName: string;
    applicantEmail: string;
    systemType: string;
    purpose: string;
    projectId: string;
    municipalityCode: string;
    pe: number;
  }>,
) {
  return useCase.patchDraft(applicationId, patch);
}

export async function recordSoilTest(applicationId: string, input: { ltar: number; testDate: string }) {
  return useCase.recordSoilTest(applicationId, input);
}

export async function recordNeighborConsent(
  applicationId: string,
  input: { address: string; distance: number; obtained?: boolean },
) {
  return useCase.recordNeighborConsent(applicationId, input);
}
