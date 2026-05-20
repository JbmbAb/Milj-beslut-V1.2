/**
 * Sewage Application Service
 * Manages the complete lifecycle of a private sewage system application
 * - Validation against regulations
 * - Gate management
 * - Status transitions
 * - Submission workflow
 */

import { prisma } from '../../db.server';
import type {
  SewageApplication,
  SewageGISAnalysis,
  SewageProtectionProfile,
  SewageSystemTypeId,
  Gate,
} from '../../types';
import {
  generateSewageRequirementChecklist,
  validateSewageApplicationRegulations,
} from './sewageRegulationsService';

export interface CreateSewageApplicationRequest {
  projectId: string;
  propertyDesignation: string;
  municipalityCode: string;
  pe: number;
  gisAnalysis: SewageGISAnalysis;
  protectionProfile: SewageProtectionProfile;
}

/**
 * Create new sewage application
 */
export async function createSewageApplication(
  request: CreateSewageApplicationRequest,
): Promise<SewageApplication> {
  const now = new Date().toISOString();

  // Generate initial requirements checklist
  const requirementChecklist = generateSewageRequirementChecklist(
    request.protectionProfile.recommendedSystem,
    request.protectionProfile.protectionLevel,
    request.municipalityCode,
    {
      toWell: request.protectionProfile.nearestWell.distance,
      toPropertyLine: request.protectionProfile.distanceToPropertyLine,
    },
  );

  // Create initial gates
  const gates: Gate[] = [
    {
      id: 'gate-SEWAGE_PROTECTION_LEVEL',
      name: 'Skyddsnivå-bedömning',
      description: `Fastigheten ligger i ${request.protectionProfile.protectionLevel === 'HIGH' ? 'högt' : 'normalt'} skyddad område`,
      status: 'COMPLETED',
      priority: 'HIGH',
    },
    {
      id: 'gate-SOIL_TEST_COMPLETED',
      name: 'Markundersökning',
      description: 'Perkolationsprov (LTAR) måste genomföras',
      status: 'PENDING',
      priority: 'HIGH',
      blockingFactor: requirementChecklist.some((r) => r.id.includes('soil-test'))
        ? 'Kräver perkolationsprov för detta systemval'
        : undefined,
    },
    {
      id: 'gate-NEIGHBOR_CONSENT',
      name: 'Grannemedgivande',
      description:
        request.protectionProfile.nearestWell.distance < 50 ||
        request.protectionProfile.distanceToPropertyLine < 4.5
          ? 'Grannemedgivande krävs – nära grannboll eller brunn'
          : 'Ej krävs för denna plats',
      status:
        request.protectionProfile.nearestWell.distance < 50 ||
        request.protectionProfile.distanceToPropertyLine < 4.5
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
    {
      id: 'gate-REGULATORY_COMPLIANCE',
      name: 'Regelverksprövning',
      description: 'Ansökan måste uppfylla alla juridiska krav',
      status: 'PENDING',
      priority: 'HIGH',
    },
  ];

  const application: SewageApplication = {
    id: `sewage-${request.propertyDesignation}-${Date.now()}`,
    projectId: request.projectId,
    propertyDesignation: request.propertyDesignation,
    pe: request.pe,
    selectedSystemType: request.protectionProfile.recommendedSystem,
    protectionProfile: request.protectionProfile,
    soilTestCompleted: false,
    neighborConsentRequired:
      request.protectionProfile.nearestWell.distance < 50 ||
      request.protectionProfile.distanceToPropertyLine < 4.5,
    neighborConsentObtained: false,
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    currentGates: gates,
  };

  return application;
}

/**
 * Update application with soil test results
 */
export async function updateSoilTestResults(
  applicationId: string,
  ltar: number,
  testDate: string,
): Promise<SewageApplication | null> {
  // In production: query database
  console.log(`[SewageApplication] Updated soil test: LTAR=${ltar}, Date=${testDate}`);

  return null;
}

/**
 * Record neighbor consent
 */
export async function recordNeighborConsent(
  applicationId: string,
  address: string,
  distance: number,
): Promise<SewageApplication | null> {
  // In production: query database
  console.log(`[SewageApplication] Recorded neighbor consent from ${address} at ${distance}m`);

  return null;
}

/**
 * Change selected system type
 */
export async function changeSewageSystem(
  applicationId: string,
  newSystemType: SewageSystemTypeId,
  protectionProfile: SewageProtectionProfile,
): Promise<SewageApplication | null> {
  // Regenerate gates based on new system type
  const checklist = generateSewageRequirementChecklist(newSystemType, protectionProfile.protectionLevel, '');

  console.log(
    `[SewageApplication] Changed system to ${newSystemType}, regenerated ${checklist.length} requirements`,
  );

  return null;
}

/**
 * Validate application before submission
 */
export function validateApplicationForSubmission(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
): {
  canSubmit: boolean;
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Check all critical gates are completed
  const criticalGates = application.currentGates.filter((g) => g.priority === 'HIGH');
  const incompleteGates = criticalGates.filter((g) => g.status !== 'COMPLETED');

  if (incompleteGates.length > 0) {
    blockers.push(
      `${incompleteGates.length} kritiska steg måste färdigställas: ${incompleteGates.map((g) => g.name).join(', ')}`,
    );
  }

  // Check soil test if required
  if (
    ['INFILTRATION', 'SOIL_BED'].includes(application.selectedSystemType) &&
    !application.soilTestCompleted
  ) {
    blockers.push('Markundersökning (perkolationsprov) är obligatorisk för detta systemval');
  }

  // Check neighbor consent if required
  if (application.neighborConsentRequired && !application.neighborConsentObtained) {
    blockers.push('Grannemedgivande måste erhållas och registreras innan inskickning');
  }

  // Check documents
  if (!application.situationPlan || !application.crossSection) {
    blockers.push('Situationsplan och tvärsektion måste genereras');
  }

  // Regulatory validation
  const { violations, warnings: regWarnings } = validateSewageApplicationRegulations(
    application,
    protectionProfile,
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
 * Update gate status
 */
export function updateGateStatus(gates: Gate[], gateId: string, newStatus: Gate['status']): Gate[] {
  return gates.map((g) => (g.id === gateId ? { ...g, status: newStatus } : g));
}

/**
 * Get all pending gates
 */
export function getPendingGates(application: SewageApplication): Gate[] {
  return application.currentGates.filter((g) => g.status === 'PENDING');
}

/**
 * Submit application to municipality
 */
export async function submitApplicationToMunicipality(
  application: SewageApplication,
  municipalityCode: string,
): Promise<{
  success: boolean;
  submissionId?: string;
  referenceNumber?: string;
  estimatedProcessingTime?: number; // weeks
  error?: string;
}> {
  // In production: send to municipality eService or generate reference number
  const referenceNumber = `AVLOPP-${municipalityCode}-${Date.now()}`;
  const submissionId = `submission-${referenceNumber}`;

  console.log(
    `[SewageApplication] Submitted application to municipality ${municipalityCode}, Ref: ${referenceNumber}`,
  );

  return {
    success: true,
    submissionId,
    referenceNumber,
    estimatedProcessingTime: application.protectionProfile.timelineEstimateWeeks || 8,
  };
}

/**
 * Generate summary for municipality submission
 */
export function generateSubmissionSummary(application: SewageApplication): Record<string, unknown> {
  return {
    referenceData: {
      propertyDesignation: application.propertyDesignation,
      pe: application.pe,
      selectedSystem: application.selectedSystemType,
    },
    gisAnalysis: {
      protectionLevel: application.protectionProfile.protectionLevel,
      riskScore: 'From GIS analysis',
      feasibility: 'From GIS analysis',
    },
    applicant: {
      // Will be filled from user context
    },
    documents: {
      situationPlan: application.situationPlan?.url,
      crossSection: application.crossSection?.url,
      performanceDeclaration: application.performanceDeclaration?.url,
    },
    status: application.status,
    submittedDate: new Date().toISOString(),
  };
}
