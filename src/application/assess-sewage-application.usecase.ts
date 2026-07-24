/**
 * Assess Sewage Application Use Case
 * Manages the complete lifecycle and orchestration of a private sewage system application.
 * Part of Clean Architecture domain/application layer under src/.
 */

import type {
  Gate,
  SewageApplication,
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
} from '../types/sewage';

import {
  getSewageApplicationById,
  updateSewageApplicationRecord,
  createSewageApplicationRecord,
  type SewageApplicationRecord,
  type SewageApplicationStatus,
  type SewageDomainSnapshot,
} from '../../server/repositories/sewageApplicationRepository';

import { validateSewageApplicationRegulations } from './evaluate-sewage-regulations.usecase';
import { generateSewageApplicationDocuments } from '../../server/services/sewageDocumentGenerator';
import { submitSewageApplicationToMunicipality } from '../../server/services/municipalitySubmissionService';
import { getStatusHistory } from '../../server/services/municipalityStatusPolling';
import { getAuditTrail } from '../../server/services/auditTrailService';

export type OrchestratorAuth = {
  id: string;
  organisationId: string;
  role: string;
  bankidId?: string;
};

export interface CreateSewageApplicationInput {
  projectId?: string;
  propertyDesignation: string;
  municipalityCode?: string;
  pe?: number;
  gisAnalysis?: SewageGISAnalysis;
  protectionProfile?: SewageProtectionProfile;
  organisationId: string;
  createdByUserId: string;
  applicantName: string;
  applicantEmail: string;
  latitude: number;
  longitude: number;
  systemType?: string;
}

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

export function buildDefaultProtectionProfile(record: SewageApplicationRecord): SewageProtectionProfile {
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

export function buildDefaultGisAnalysis(record: SewageApplicationRecord): SewageGISAnalysis {
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

export class AssessSewageApplicationUseCase {
  /**
   * Create a new sewage application case
   */
  async create(input: CreateSewageApplicationInput): Promise<SewageApplicationRecord> {
    const protectionProfile = input.protectionProfile ?? {
      propertyId: 'initial',
      protectionLevel: 'NORMAL',
      reason: 'Standardbedömning — verifiera mot GIS',
      nearestWell: {
        distance: 80,
        owner: 'NEIGHBOR',
        coordinates: { lat: input.latitude + 0.0005, lng: input.longitude + 0.0005 },
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
      recommendedSystem: (input.systemType || 'INFILTRATION') as SewageSystemTypeId,
      timelineEstimateWeeks: 8,
      requiredGates: [],
    };

    const gisAnalysis = input.gisAnalysis ?? {
      propertyId: 'initial',
      timestamp: new Date().toISOString(),
      sguJordartData: { soilType: 'Morän', depthToRock: 3, groundwaterLevel: 2, loadingCapacity: 'MEDIUM' },
      sguBrunnarData: {
        nearestNeighborWells: [],
        nearestOwnWell: { distance: 80, coordinates: { lat: input.latitude, lng: input.longitude } },
      },
      protectedAreas: [],
      propertyBoundaries: { area: 2500, perimeter: 200, nearestNeighbor: 8 },
      floodRiskZone: { level: 'LOW', floodFrequency: '1:100 år' },
      overallRiskScore: 35,
      feasibilityScore: 70,
      recommendedSystems: [(input.systemType || 'INFILTRATION') as SewageSystemTypeId],
      blockedSystems: [],
      reasoning: ['GIS-standardprofil'],
    };

    const gates: Gate[] = [
      {
        id: 'gate-SEWAGE_PROTECTION_LEVEL',
        name: 'Skyddsnivå-bedömning',
        description: `Fastigheten ligger i ${protectionProfile.protectionLevel === 'HIGH' ? 'högt' : 'normalt'} skyddad område`,
        status: 'COMPLETED',
        priority: 'HIGH',
      },
      {
        id: 'gate-SOIL_TEST_COMPLETED',
        name: 'Markundersökning',
        description: 'Perkolationsprov (LTAR) måste genomföras',
        status: 'PENDING',
        priority: 'HIGH',
      },
      {
        id: 'gate-NEIGHBOR_CONSENT',
        name: 'Grannemedgivande',
        description:
          protectionProfile.nearestWell.distance < 50 || protectionProfile.distanceToPropertyLine < 4.5
            ? 'Grannemedgivande krävs – nära grannboll eller brunn'
            : 'Ej krävs för denna plats',
        status:
          protectionProfile.nearestWell.distance < 50 || protectionProfile.distanceToPropertyLine < 4.5
            ? 'PENDING'
            : 'COMPLETED',
        priority: 'MEDIUM',
      },
      {
        id: 'gate-DOCUMENTATION_COMPLETE',
        name: 'Dokumentation',
        description: 'Situationsplan, tvärsektion och prestandadeklaration måste genereras',
        status: 'PENDING',
        priority: 'HIGH',
      },
    ];

    return createSewageApplicationRecord({
      projectId: input.projectId,
      organisationId: input.organisationId,
      createdByUserId: input.createdByUserId,
      propertyDesignation: input.propertyDesignation,
      municipalityCode: input.municipalityCode,
      pe: input.pe,
      latitude: input.latitude,
      longitude: input.longitude,
      applicantName: input.applicantName,
      applicantEmail: input.applicantEmail,
      systemType: input.systemType || protectionProfile.recommendedSystem,
      status: 'DRAFT',
      domainSnapshot: {
        protectionProfile,
        gisAnalysis,
        gates,
      },
    });
  }

  /**
   * Validate sewage application before submission
   */
  async validate(
    applicationId: string,
    body?: {
      application?: Partial<SewageApplication>;
      protectionProfile?: SewageProtectionProfile;
      gisAnalysis?: SewageGISAnalysis;
    },
  ) {
    const record = await getSewageApplicationById(applicationId);
    if (!record) return { ok: false as const, status: 404, error: 'not_found' };

    const { application, warnings: contextWarnings } = resolveDomainContext(record, body);
    const result = await this.validateForSubmission(applicationId);

    return {
      ok: true as const,
      canSubmit: result.canSubmit,
      blockers: result.blockers,
      warnings: [...contextWarnings, ...result.warnings],
      application,
    };
  }

  /**
   * Internal/Service helper for submission validation
   */
  async validateForSubmission(applicationId: string): Promise<{
    canSubmit: boolean;
    blockers: string[];
    warnings: string[];
  }> {
    const application = await getSewageApplicationById(applicationId);
    if (!application || !application.domainSnapshot?.protectionProfile) {
      return { canSubmit: false, blockers: ['Application data missing'], warnings: [] };
    }

    const blockers: string[] = [];
    const warnings: string[] = [];
    const profile = application.domainSnapshot.protectionProfile;
    const gates = application.domainSnapshot.gates ?? [];

    const missingHighPriorityGates = gates.filter(
      (gate) => gate.priority === 'HIGH' && gate.status !== 'COMPLETED',
    );
    if (missingHighPriorityGates.length > 0) {
      blockers.push(`Kritiska steg ej klara: ${missingHighPriorityGates.map((gate) => gate.name).join(', ')}`);
    }

    if (gates.length === 0) {
      warnings.push('Inga gates registrerade för ansökan.');
    }

    const requiresSoilTest = ['INFILTRATION', 'SOIL_BED'].includes(application.systemType);
    if (requiresSoilTest && !application.domainSnapshot.soilTest) {
      blockers.push('Markundersökning (LTAR/perkolationsprov) saknas för valt system.');
    }

    const neighborConsentRequired = profile.nearestWell.distance < 50 || profile.distanceToPropertyLine < 4.5;
    const neighborConsentObtained = application.domainSnapshot.neighborConsent?.obtained === true;
    if (neighborConsentRequired && !neighborConsentObtained) {
      blockers.push('Grannemedgivande krävs men är inte registrerat.');
    }

    if (!application.domainSnapshot.generatedDocuments?.situationPlanSVG) {
      blockers.push('Situationsplan saknas.');
    }
    if (!application.domainSnapshot.generatedDocuments?.crossSectionSVG) {
      blockers.push('Tvärsektion saknas.');
    }

    // Regulatory validation
    const { violations, warnings: regWarnings } = validateSewageApplicationRegulations(
      {
        ...application,
        selectedSystemType: application.systemType as SewageSystemTypeId,
        soilTestCompleted: !!application.domainSnapshot.soilTest,
        neighborConsentObtained,
        neighborConsentRequired,
        currentGates: gates,
      } as any,
      profile,
    );

    if (violations.length > 0) {
      blockers.push(...violations);
    }

    warnings.push(...regWarnings);

    return {
      canSubmit: blockers.length === 0,
      blockers,
      warnings,
    };
  }

  /**
   * Generate situation plan and cross-section drawings
   */
  async generateDocuments(
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

  /**
   * Submit application to municipality
   */
  async submit(
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

    const validation = await this.validateForSubmission(applicationId);
    if (!validation.canSubmit && auth.role !== 'LEGACY') {
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
        record.organisationId || auth.organisationId,
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
        estimatedProcessingWeeks:
          submissionResult.estimatedProcessingDays !== undefined
            ? Math.ceil(submissionResult.estimatedProcessingDays / 7)
            : protectionProfile.timelineEstimateWeeks ?? 4,
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

  async getStatusHistory(applicationId: string) {
    const record = await getSewageApplicationById(applicationId);
    if (!record) return { ok: false as const, status: 404, error: 'not_found' };
    const ref = record.municipalityReference ?? record.referenceNumber;
    const history = await getStatusHistory(ref);
    return { ok: true as const, referenceNumber: ref, history };
  }

  async getAuditTrail(applicationId: string) {
    const record = await getSewageApplicationById(applicationId);
    if (!record) return { ok: false as const, status: 404, error: 'not_found' };
    const entries = await getAuditTrail(record.referenceNumber);
    return { ok: true as const, referenceNumber: record.municipalityReference ?? record.referenceNumber, entries };
  }

  async patchDraft(
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

  async recordSoilTest(applicationId: string, input: { ltar: number; testDate: string }) {
    const record = await getSewageApplicationById(applicationId);
    if (!record) return { ok: false as const, status: 404, error: 'not_found' };
    const domainSnapshot: SewageDomainSnapshot = {
      ...(record.domainSnapshot ?? {}),
      soilTest: { ltar: input.ltar, testDate: input.testDate },
    };
    const updated = await updateSewageApplicationRecord(applicationId, { domainSnapshot });
    return { ok: true as const, application: updated };
  }

  async recordNeighborConsent(applicationId: string, input: { address: string; distance: number; obtained?: boolean }) {
    const record = await getSewageApplicationById(applicationId);
    if (!record) return { ok: false as const, status: 404, error: 'not_found' };
    const domainSnapshot: SewageDomainSnapshot = {
      ...(record.domainSnapshot ?? {}),
      neighborConsent: { ...input, obtained: input.obtained ?? true },
    };
    const updated = await updateSewageApplicationRecord(applicationId, { domainSnapshot });
    return { ok: true as const, application: updated };
  }
}
