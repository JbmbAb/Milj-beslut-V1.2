/**
 * Orkestrering av enskilt-avlopp-flödet: record ↔ domän ↔ tjänster.
 */

import type {
  Gate,
  SewageApplication,
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
} from '../../../types';
import {
  getSewageApplicationById,
  updateSewageApplicationRecord,
  type SewageApplicationRecord,
  type SewageApplicationStatus,
  type SewageDomainSnapshot,
} from '../../repositories/sewageApplicationRepository';
import { validateApplicationForSubmission } from '../../services/sewageApplicationService';
import { generateSewageApplicationDocuments } from '../../services/sewageDocumentGenerator';
import { submitSewageApplicationToMunicipality } from '../../services/municipalitySubmissionService';
import { getStatusHistory } from '../../services/municipalityStatusPolling';
import { getAuditTrail } from '../../services/auditTrailService';

export type OrchestratorAuth = {
  id: string;
  organisationId: string;
  role: string;
  bankidId?: string;
};

export function recordStatusToDomain(status: SewageApplicationStatus): SewageApplication['status'] {
  switch (status) {
    case 'IN_REVIEW':
      return 'UNDER_REVIEW';
    case 'DECISION':
      return 'APPROVED';
    case 'SUBMITTED':
      return 'SUBMITTED';
    default:
      return 'DRAFT';
  }
}

function buildDefaultProtectionProfile(record: SewageApplicationRecord): SewageProtectionProfile {
  return {
    propertyId: record.id,
    protectionLevel: 'NORMAL',
    reason: 'Standardbedömning — verifiera mot GIS i staging',
    nearestWell: {
      distance: 80,
      owner: 'NEIGHBOR',
      coordinates: { lat: record.latitude + 0.0005, lng: record.longitude + 0.0005 },
    },
    nearestWaterCourse: { distance: 120, type: 'Bäck' },
    distanceToPropertyLine: 8,
    soilProfile: {
      soilType: 'Morän',
      depthToRock: 3,
      groundwaterLevel: 2,
      infiltrationCapacity: 'MEDIUM',
      permeability: 20,
    },
    floodRisk: 'LOW',
    protectedNatureNearby: false,
    recommendedSystem: record.systemType as SewageSystemTypeId,
    timelineEstimateWeeks: 8,
    requiredGates: [],
  };
}

function buildDefaultGisAnalysis(record: SewageApplicationRecord): SewageGISAnalysis {
  return {
    propertyId: record.id,
    timestamp: new Date().toISOString(),
    sguJordartData: {
      soilType: 'Morän',
      depthToRock: 3,
      groundwaterLevel: 2,
      loadingCapacity: 'MEDIUM',
    },
    sguBrunnarData: {
      nearestNeighborWells: [],
      nearestOwnWell: {
        distance: 80,
        coordinates: { lat: record.latitude, lng: record.longitude },
      },
    },
    protectedAreas: [],
    propertyBoundaries: { area: 2500, perimeter: 200, nearestNeighbor: 8 },
    floodRiskZone: { level: 'LOW', floodFrequency: '1:100 år' },
    overallRiskScore: 35,
    feasibilityScore: 70,
    recommendedSystems: [record.systemType as SewageSystemTypeId],
    blockedSystems: [],
    reasoning: ['GIS-standardprofil — ersätt med livekällor i staging-bevis'],
  };
}

export function resolveDomainContext(
  record: SewageApplicationRecord,
  body?: {
    application?: Partial<SewageApplication>;
    protectionProfile?: SewageProtectionProfile;
    gisAnalysis?: SewageGISAnalysis;
    municipalityCode?: string;
    projectId?: string;
    pe?: number;
  },
): {
  application: SewageApplication;
  protectionProfile: SewageProtectionProfile;
  gisAnalysis: SewageGISAnalysis;
  warnings: string[];
} {
  const warnings: string[] = [];
  const snapshot = record.domainSnapshot ?? {};
  let usedDefaultGis = false;

  const protectionProfile =
    body?.protectionProfile ?? snapshot.protectionProfile ?? buildDefaultProtectionProfile(record);
  if (!body?.protectionProfile && !snapshot.protectionProfile) {
    warnings.push('protectionProfile saknas — standardprofil används; verifiera i staging.');
    usedDefaultGis = true;
  }

  const gisAnalysis = body?.gisAnalysis ?? snapshot.gisAnalysis ?? buildDefaultGisAnalysis(record);
  if (!body?.gisAnalysis && !snapshot.gisAnalysis) {
    warnings.push('gisAnalysis saknas — standardprofil används; verifiera mot SGU/Lantmäteriet i staging.');
    usedDefaultGis = true;
  }

  const gates: Gate[] = body?.application?.currentGates ?? [
    {
      id: 'gate-DOCUMENTATION_COMPLETE',
      name: 'Dokumentation',
      description: 'Situationsplan och tvärsektion',
      status: snapshot.generatedDocuments?.situationPlanSVG ? 'COMPLETED' : 'PENDING',
      priority: 'HIGH',
    },
  ];

  const application: SewageApplication = {
    id: record.id,
    projectId: body?.projectId ?? record.projectId ?? body?.application?.projectId ?? 'unassigned',
    propertyDesignation: record.propertyDesignation,
    pe: body?.pe ?? record.pe,
    selectedSystemType: (body?.application?.selectedSystemType ?? record.systemType) as SewageSystemTypeId,
    protectionProfile,
    soilTestCompleted: Boolean(snapshot.soilTest),
    ltar: snapshot.soilTest?.ltar,
    percolationTestDate: snapshot.soilTest?.testDate,
    neighborConsentRequired: protectionProfile.nearestWell.distance < 50,
    neighborConsentObtained: snapshot.neighborConsent?.obtained ?? false,
    neighborDetails: snapshot.neighborConsent
      ? { address: snapshot.neighborConsent.address, distance: snapshot.neighborConsent.distance }
      : undefined,
    situationPlan: snapshot.generatedDocuments?.situationPlanSVG
      ? {
          generatedDate: snapshot.generatedDocuments.generatedAt ?? record.updatedAt,
          url: 'inline:situation',
        }
      : undefined,
    crossSection: snapshot.generatedDocuments?.crossSectionSVG
      ? { generatedDate: snapshot.generatedDocuments.generatedAt ?? record.updatedAt, url: 'inline:cross' }
      : undefined,
    status: recordStatusToDomain(record.status),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    currentGates: gates,
    ...body?.application,
  };

  if (usedDefaultGis && process.env.NODE_ENV !== 'test') {
    updateSewageApplicationRecord(record.id, {
      domainSnapshot: { ...snapshot, usedDefaultGis: true, protectionProfile, gisAnalysis },
    });
  }

  return { application, protectionProfile, gisAnalysis, warnings };
}

export async function validateSewageApplication(
  applicationId: string,
  body?: {
    application?: Partial<SewageApplication>;
    protectionProfile?: SewageProtectionProfile;
    gisAnalysis?: SewageGISAnalysis;
  },
) {
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };

  const { application, warnings } = resolveDomainContext(record, body);
  const result = await validateApplicationForSubmission(applicationId);

  return {
    ok: true as const,
    canSubmit: result.canSubmit,
    blockers: result.blockers,
    warnings: [...warnings, ...result.warnings],
    application,
  };
}

export async function generateDocumentsForApplication(
  applicationId: string,
  body?: {
    application?: Partial<SewageApplication>;
    protectionProfile?: SewageProtectionProfile;
    gisAnalysis?: SewageGISAnalysis;
  },
) {
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };

  const { application, protectionProfile, gisAnalysis, warnings } = resolveDomainContext(record, body);
  const docs = generateSewageApplicationDocuments(application, protectionProfile, gisAnalysis);

  const domainSnapshot: SewageDomainSnapshot = {
    ...(record.domainSnapshot ?? {}),
    protectionProfile,
    gisAnalysis,
    generatedDocuments: {
      situationPlanSVG: docs.situationPlanSVG,
      crossSectionSVG: docs.crossSectionSVG,
      generatedAt: docs.generatedAt,
    },
  };

  await updateSewageApplicationRecord(applicationId, { domainSnapshot });

  return {
    ok: true as const,
    situationPlanSVG: docs.situationPlanSVG,
    crossSectionSVG: docs.crossSectionSVG,
    generatedAt: docs.generatedAt,
    warnings,
  };
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
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };

  const municipalityCode = body.municipalityCode || record.municipalityCode;
  if (!municipalityCode) {
    return {
      ok: false as const,
      status: 400,
      error: 'municipality_code_required',
      message: 'municipalityCode krävs för inlämning.',
    };
  }

  const projectId = body.projectId ?? record.projectId;
  if (!projectId || projectId === 'unassigned') {
    return {
      ok: false as const,
      status: 400,
      error: 'project_id_required',
      message: 'projectId krävs för inlämning.',
    };
  }

  const { application, protectionProfile, gisAnalysis, warnings } = resolveDomainContext(record, {
    ...body,
    municipalityCode,
    projectId,
  });

  const validation = await validateApplicationForSubmission(applicationId);
  if (!validation.canSubmit) {
    return {
      ok: false as const,
      status: 422,
      error: 'validation_failed',
      blockers: validation.blockers,
      warnings: [...warnings, ...validation.warnings],
    };
  }

  let situationPlan = body.situationPlanSVG ?? record.domainSnapshot?.generatedDocuments?.situationPlanSVG;
  let crossSection = body.crossSectionSVG ?? record.domainSnapshot?.generatedDocuments?.crossSectionSVG;

  if (!situationPlan || !crossSection) {
    const docs = generateSewageApplicationDocuments(application, protectionProfile, gisAnalysis);
    situationPlan = docs.situationPlanSVG;
    crossSection = docs.crossSectionSVG;
  }

  try {
    const submissionResult = await submitSewageApplicationToMunicipality(
      application,
      protectionProfile,
      municipalityCode,
      situationPlan,
      crossSection,
      record.applicantEmail,
      projectId,
      auth.organisationId,
    );

    const updated = await updateSewageApplicationRecord(applicationId, {
      status: 'SUBMITTED',
      municipalityCode,
      projectId,
      municipalityReference: submissionResult.referenceNumber,
      domainSnapshot: {
        ...(record.domainSnapshot ?? {}),
        protectionProfile,
        gisAnalysis,
        generatedDocuments: {
          situationPlanSVG: situationPlan,
          crossSectionSVG: crossSection,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    return {
      ok: true as const,
      referenceNumber: submissionResult.referenceNumber,
      municipalityCode: submissionResult.municipalityCode,
      municipalityEmail: submissionResult.municipalityContactEmail,
      estimatedProcessingWeeks: Math.ceil((submissionResult.estimatedProcessingDays ?? 30) / 7),
      submittedAt: submissionResult.submittedAt,
      application: updated,
      warnings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('endpoint') || message.includes('Municipality')) {
      return {
        ok: false as const,
        status: 503,
        error: 'municipality_not_configured',
        message: 'Kommunintegration är inte konfigurerad för denna miljö.',
      };
    }
    throw err;
  }
}

export async function getApplicationStatusHistory(applicationId: string) {
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  const ref = record.municipalityReference ?? record.referenceNumber;
  const history = await getStatusHistory(ref);
  return { ok: true as const, referenceNumber: ref, history };
}

export async function getApplicationAuditTrail(applicationId: string) {
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  const entries = await getAuditTrail(record.referenceNumber);
  return { ok: true as const, referenceNumber: record.municipalityReference ?? record.referenceNumber, entries };
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
  const updated = await updateSewageApplicationRecord(applicationId, patch);
  if (!updated) return { ok: false as const, status: 404, error: 'not_found' };
  return { ok: true as const, application: updated };
}

export async function recordSoilTest(applicationId: string, input: { ltar: number; testDate: string }) {
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  const domainSnapshot: SewageDomainSnapshot = {
    ...(record.domainSnapshot ?? {}),
    soilTest: { ltar: input.ltar, testDate: input.testDate },
  };
  const updated = await updateSewageApplicationRecord(applicationId, { domainSnapshot });
  return { ok: true as const, application: updated };
}

export async function recordNeighborConsent(
  applicationId: string,
  input: { address: string; distance: number },
) {
  const record = await getSewageApplicationById(applicationId);
  if (!record) return { ok: false as const, status: 404, error: 'not_found' };
  const domainSnapshot: SewageDomainSnapshot = {
    ...(record.domainSnapshot ?? {}),
    neighborConsent: { ...input, obtained: true },
  };
  const updated = await updateSewageApplicationRecord(applicationId, { domainSnapshot });
  return { ok: true as const, application: updated };
}
