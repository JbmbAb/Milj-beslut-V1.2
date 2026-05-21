/**
 * Sewage Application Service
 * Manages the complete lifecycle of a private sewage system application
 */

import type {
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
  Gate,
} from '../../types';
import {
  validateSewageApplicationRegulations,
} from './sewageRegulationsService';
import { 
  createSewageApplicationRecord, 
  getSewageApplicationById, 
  updateSewageApplicationRecord,
  type SewageApplicationRecord 
} from '../repositories/sewageApplicationRepository';

export interface CreateSewageApplicationRequest {
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

/**
 * Create new sewage application
 */
export async function createSewageApplication(
  request: CreateSewageApplicationRequest,
): Promise<SewageApplicationRecord> {
  // Use provided profile/analysis or build defaults
  const protectionProfile = request.protectionProfile ?? {
    propertyId: 'initial',
    protectionLevel: 'NORMAL',
    reason: 'Standardbedömning — verifiera mot GIS',
    nearestWell: { 
      distance: 80, 
      owner: 'NEIGHBOR', 
      coordinates: { lat: request.latitude + 0.0005, lng: request.longitude + 0.0005 } 
    },
    nearestWaterCourse: { distance: 120, type: 'Bäck' },
    distanceToPropertyLine: 8,
    soilProfile: { soilType: 'Morän', depthToRock: 3, groundwaterLevel: 2, infiltrationCapacity: 'MEDIUM', permeability: 20 },
    floodRisk: 'LOW',
    protectedNatureNearby: false,
    recommendedSystem: (request.systemType || 'INFILTRATION') as SewageSystemTypeId,
    timelineEstimateWeeks: 8,
    requiredGates: []
  };

  const gisAnalysis = request.gisAnalysis ?? {
    propertyId: 'initial',
    timestamp: new Date().toISOString(),
    sguJordartData: { soilType: 'Morän', depthToRock: 3, groundwaterLevel: 2, loadingCapacity: 'MEDIUM' },
    sguBrunnarData: { nearestNeighborWells: [], nearestOwnWell: { distance: 80, coordinates: { lat: request.latitude, lng: request.longitude } } },
    protectedAreas: [],
    propertyBoundaries: { area: 2500, perimeter: 200, nearestNeighbor: 8 },
    floodRiskZone: { level: 'LOW', floodFrequency: '1:100 år' },
    overallRiskScore: 35,
    feasibilityScore: 70,
    recommendedSystems: [(request.systemType || 'INFILTRATION') as SewageSystemTypeId],
    blockedSystems: [],
    reasoning: ['GIS-standardprofil']
  };

  // Create initial gates (domain logic)
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
        protectionProfile.nearestWell.distance < 50 ||
        protectionProfile.distanceToPropertyLine < 4.5
          ? 'Grannemedgivande krävs – nära grannboll eller brunn'
          : 'Ej krävs för denna plats',
      status:
        protectionProfile.nearestWell.distance < 50 ||
        protectionProfile.distanceToPropertyLine < 4.5
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

  // Persist via repository
  return createSewageApplicationRecord({
    projectId: request.projectId,
    organisationId: request.organisationId,
    createdByUserId: request.createdByUserId,
    propertyDesignation: request.propertyDesignation,
    municipalityCode: request.municipalityCode,
    pe: request.pe,
    latitude: request.latitude,
    longitude: request.longitude,
    applicantName: request.applicantName,
    applicantEmail: request.applicantEmail,
    systemType: request.systemType || protectionProfile.recommendedSystem,
    status: 'DRAFT',
    domainSnapshot: {
      protectionProfile,
      gisAnalysis,
      gates,
    }
  });
}

/**
 * Update application with soil test results
 */
export async function updateSoilTestResults(
  applicationId: string,
  ltar: number,
  testDate: string,
): Promise<SewageApplicationRecord | null> {
  return updateSewageApplicationRecord(applicationId, {
    domainSnapshot: {
      soilTest: { ltar, testDate }
    }
  });
}

/**
 * Record neighbor consent
 */
export async function recordNeighborConsent(
  applicationId: string,
  address: string,
  distance: number,
  obtained: boolean = true
): Promise<SewageApplicationRecord | null> {
  return updateSewageApplicationRecord(applicationId, {
    domainSnapshot: {
      neighborConsent: { address, distance, obtained }
    }
  });
}

/**
 * Change selected system type
 */
export async function changeSewageSystem(
  applicationId: string,
  newSystemType: SewageSystemTypeId,
  protectionProfile: SewageProtectionProfile,
): Promise<SewageApplicationRecord | null> {
  return updateSewageApplicationRecord(applicationId, {
    systemType: newSystemType,
    domainSnapshot: { protectionProfile }
  });
}

/**
 * Validate application before submission
 */
export async function validateApplicationForSubmission(
  applicationId: string
): Promise<{
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

  const missingHighPriorityGates = gates.filter((gate) => gate.priority === 'HIGH' && gate.status !== 'COMPLETED');
  if (missingHighPriorityGates.length > 0) {
    blockers.push(
      `Kritiska steg ej klara: ${missingHighPriorityGates.map((gate) => gate.name).join(', ')}`,
    );
  }

  if (gates.length === 0) {
    warnings.push('Inga gates registrerade för ansökan.');
  }

  const requiresSoilTest = ['INFILTRATION', 'SOIL_BED'].includes(application.systemType);
  if (requiresSoilTest && !application.domainSnapshot.soilTest) {
    blockers.push('Markundersökning (LTAR/perkolationsprov) saknas för valt system.');
  }

  const neighborConsentRequired =
    profile.nearestWell.distance < 50 || profile.distanceToPropertyLine < 4.5;
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
    profile
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
 * Submit application to municipality
 */
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
  const application = await getSewageApplicationById(applicationId);
  if (!application) {
    return { success: false, error: 'Application not found' };
  }

  // Generate municipality-specific submission reference
  const municipalityReference = `AVLOPP-${municipalityCode}-${Date.now()}`;
  const submissionId = `submission-${municipalityReference}`;

  await updateSewageApplicationRecord(applicationId, {
    status: 'SUBMITTED',
    municipalityReference: municipalityReference
  });

  return {
    success: true,
    submissionId,
    referenceNumber: municipalityReference,
    estimatedProcessingTime: application.domainSnapshot?.protectionProfile?.timelineEstimateWeeks || 8,
  };
}
