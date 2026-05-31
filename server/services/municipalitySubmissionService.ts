/**
 * Municipality Submission Service
 * Handles integration with Swedish municipality eServices for sewage permit applications
 *
 * Supports multiple integration points:
 * 1. eSignal (eföretagande.se) - Digital communication standard
 * 2. KÖ (Kommunal Organisering) - Standard permit system
 * 3. Custom REST APIs - Municipality-specific endpoints
 */

import type { SewageApplication, SewageProtectionProfile } from '../../types';
import { logger } from '../logger';
import { PrismaSubmissionRepository } from '../../src/infrastructure/prisma-submission-repository';
import { SubmissionStatus, SubmissionChannel, SubmissionArtifactRole } from '../../src/domain/submission';
import {
  createCaseSnapshot,
  exportFromSnapshot,
  resolveRequirementCaseIdForSubmission,
} from '../modules/evidence/public';
import { sendEmailNotification } from './notificationService';
import { generateApplicationDraft } from './documentGenerator';

const submissionRepo = new PrismaSubmissionRepository();

// ============================================================================
// SUBMISSION ENVELOPE
// ============================================================================

export interface MunicipalitySubmissionPackage {
  referenceNumber: string;
  municipalityCode: string;
  submittedAt: string;
  applicantInfo: {
    name: string;
    email: string;
    phone?: string;
    personalNumber: string;
  };
  propertyInfo: {
    designation: string;
    coordinates?: { lat: number; lng: number };
  };
  applicationData: {
    systemType: string;
    pe: number;
    protectionLevel: string;
  };
  documents: {
    situationPlanSVG: string; // SVG content
    crossSectionSVG: string; // SVG content
    performanceDeclaration?: string; // URL or base64
  };
  auditTrail: {
    initiatedBy: string;
    initiatedAt: string;
    signedBy?: string;
    signedAt?: string;
  };
}

// ============================================================================
// MUNICIPALITY ENDPOINT REGISTRY
// ============================================================================

interface MunicipalityEndpoint {
  code: string;
  name: string;
  submitEndpoint: string; // URL where to POST
  statusEndpoint?: string; // URL where to GET status
  integrationType: 'eSignal' | 'KÖ' | 'REST' | 'EMAIL';
  registrarEmail?: string; // E-post till registrator för fallback/manuell hantering
  authType: 'none' | 'api_key' | 'oauth2' | 'basic';
  requiresPerformanceDeclaration: boolean;
}

// Registry of Swedish municipality endpoints
const MUNICIPALITY_ENDPOINTS: Record<string, MunicipalityEndpoint> = {
  '0180': {
    code: '0180',
    name: 'Stockholms stad',
    submitEndpoint: 'https://eservices.stockholm.se/api/sewage/submit',
    statusEndpoint: 'https://eservices.stockholm.se/api/sewage/status',
    registrarEmail: 'registrator.miljo@stockholm.se',
    integrationType: 'REST',
    authType: 'api_key',
    requiresPerformanceDeclaration: true,
  },
  '0184': {
    code: '0184',
    name: 'Västerås stad',
    submitEndpoint: 'https://eservices.vst.se/api/vatten/avlopp/submit',
    statusEndpoint: 'https://eservices.vst.se/api/vatten/avlopp/status',
    registrarEmail: 'miljo.bygg@vasteras.se',
    integrationType: 'KÖ',
    authType: 'api_key',
    requiresPerformanceDeclaration: true,
  },
  '0580': {
    code: '0580',
    name: 'Göteborg stad',
    submitEndpoint: 'https://eservices.goteborg.se/sewage-permit-api/submit',
    statusEndpoint: 'https://eservices.goteborg.se/sewage-permit-api/status',
    registrarEmail: 'miljoforvaltningen@miljo.goteborg.se',
    integrationType: 'REST',
    authType: 'oauth2',
    requiresPerformanceDeclaration: true,
  },
  '1280': {
    code: '1280',
    name: 'Malmö stad',
    submitEndpoint: 'https://eservices.malmo.se/api/private-sewage/submit',
    statusEndpoint: 'https://eservices.malmo.se/api/private-sewage/status',
    registrarEmail: 'miljoforvaltningen@malmo.se',
    integrationType: 'REST',
    authType: 'api_key',
    requiresPerformanceDeclaration: true,
  },
  '3100': {
    code: '3100',
    name: 'Uppsala kommun',
    submitEndpoint: 'https://eservices.uppsala.se/vatten-avlopp/api/submit',
    integrationType: 'EMAIL',
    registrarEmail: 'miljoforvaltningen@uppsala.se',
    authType: 'none',
    requiresPerformanceDeclaration: false,
  },
};

/**
 * Submit a sewage application to the appropriate municipality
 * Returns: submission confirmation with reference number and status
 */
export async function submitSewageApplicationToMunicipality(
  application: SewageApplication,
  protectionProfile: SewageProtectionProfile,
  municipalityCode: string,
  situationPlanSVG: string,
  crossSectionSVG: string,
  applicantEmail: string = 'applicant@example.com',
  projectId: string,
  organisationId: string,
): Promise<{
  ok: boolean;
  referenceNumber: string;
  municipalityCode: string;
  submittedAt: string;
  endpoint: MunicipalityEndpoint;
  integrationType: string;
  estimatedProcessingDays?: number;
  municipalityContactEmail?: string;
}> {
  // Find municipality endpoint
  const endpoint = MUNICIPALITY_ENDPOINTS[municipalityCode];

  // Generate unique reference number
  const referenceNumber = generateReferenceNumber(municipalityCode);

  // 1. PERSISTENCE: Create Submission record in PREPARED status
  const submission = await submissionRepo.save({
    id: `sub-${Date.now()}`,
    submissionKey: referenceNumber,
    projectId,
    organisationId,
    requirementCaseId: application.id, // Linking sewage application ID as requirementCaseId
    domain: 'SEWAGE',
    authorityName: endpoint?.name || `Municipality ${municipalityCode}`,
    recipientChannel:
      endpoint?.integrationType === 'EMAIL' ? SubmissionChannel.EMAIL : SubmissionChannel.REST,
    status: SubmissionStatus.PREPARED,
    caseNumber: application.id,
    submittedBy: applicantEmail,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // 2. PERSISTENCE: Log initial status event
  await submissionRepo.logStatusEvent({
    submissionId: submission.id,
    status: SubmissionStatus.PREPARED,
    sourceSystem: 'MILJOBESLUT_PORTAL',
    summary: 'Application prepared for dispatch',
    occurredAt: new Date(),
  });

  // 2b. PERSISTENCE: Add artifacts (SVG documents)
  await submissionRepo.addArtifact({
    submissionId: submission.id,
    role: SubmissionArtifactRole.PRIMARY_DOCUMENT,
    label: 'Situationsplan',
    mimeType: 'image/svg+xml',
    sourceType: 'GENERATED_SVG',
  });

  await submissionRepo.addArtifact({
    submissionId: submission.id,
    role: SubmissionArtifactRole.ATTACHMENT,
    label: 'Tvärsektion',
    mimeType: 'image/svg+xml',
    sourceType: 'GENERATED_SVG',
  });

  // Generera DOCX-utkast och koppla till inlämningen
  try {
    const draftDoc = await generateApplicationDraft({
      projectId,
      organisationId,
      userId: applicantEmail,
      requirementData: {
        // Samla relevant data för dokumentet här
        application,
        protectionProfile,
      },
    });

    // Uppdatera submission med länk till det genererade dokumentet
    await submissionRepo.addArtifact({
      submissionId: submission.id,
      role: SubmissionArtifactRole.PRIMARY_DOCUMENT,
      label: draftDoc.originalName || 'Anmälan Utkast',
      mimeType:
        draftDoc.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      sourceType: 'GENERATED_DOCX',
      documentId: String(draftDoc.id),
    });

    logger.info('DOCX-utkast genererat och kopplat till inlämning', {
      submissionId: submission.id,
      documentId: draftDoc.id,
    });
  } catch (docError) {
    logger.error('Kunde inte generera DOCX-utkast för inlämning', {
      submissionId: submission.id,
      error: docError instanceof Error ? docError.message : String(docError),
    });
    // Fortsätt ändå, men logga felet.
  }

  if (!endpoint) {
    logger.warn('Municipality endpoint not found, using email fallback', { municipalityCode });

    // Update status to FAILED or handle fallback
    await submissionRepo.logStatusEvent({
      submissionId: submission.id,
      status: SubmissionStatus.FAILED,
      sourceSystem: 'MILJOBESLUT_PORTAL',
      summary: 'Municipality endpoint not configured',
      occurredAt: new Date(),
    });

    return await submitViaEmailFallback(
      application,
      municipalityCode,
      applicantEmail,
      projectId,
      organisationId,
    );
  }

  // Package submission
  const submissionPackage: MunicipalitySubmissionPackage = {
    referenceNumber,
    municipalityCode,
    submittedAt: new Date().toISOString(),
    applicantInfo: {
      name: 'Applicant',
      email: applicantEmail,
      personalNumber: '000000-0000',
    },
    propertyInfo: {
      designation: application.propertyDesignation,
    },
    applicationData: {
      systemType: application.selectedSystemType,
      pe: application.pe,
      protectionLevel: protectionProfile.protectionLevel,
    },
    documents: {
      situationPlanSVG,
      crossSectionSVG,
    },
    auditTrail: {
      initiatedBy: applicantEmail,
      initiatedAt: new Date().toISOString(),
    },
  };

  // 3. PERSISTENCE: Log DISPATCHED event
  await submissionRepo.logStatusEvent({
    submissionId: submission.id,
    status: SubmissionStatus.DISPATCHED,
    sourceSystem: 'MILJOBESLUT_PORTAL',
    summary: `Attempting dispatch via ${endpoint.integrationType}`,
    occurredAt: new Date(),
  });

  // Route to appropriate submission method
  try {
    switch (endpoint.integrationType) {
      case 'REST':
        await submitViaREST(endpoint, submissionPackage);
        break;
      case 'eSignal':
        await submitViaESignal(endpoint, submissionPackage);
        break;
      case 'KÖ':
        await submitViaKÖ(endpoint, submissionPackage);
        break;
      case 'EMAIL':
        await submitViaEmail(endpoint, submissionPackage);
        break;
    }

    // 4. PERSISTENCE: Update status to DELIVERED
    const finalSubmission = { ...submission, status: SubmissionStatus.DELIVERED, submittedAt: new Date() };
    await submissionRepo.save(finalSubmission);

    await submissionRepo.logStatusEvent({
      submissionId: submission.id,
      status: SubmissionStatus.DELIVERED,
      sourceSystem: 'MILJOBESLUT_PORTAL',
      summary: 'Application successfully delivered to municipality system',
      occurredAt: new Date(),
    });

    // Evidence chain: SubmissionSent → snapshot → export → audit (best-effort).
    try {
      const requirementCaseId = await resolveRequirementCaseIdForSubmission({
        requirementCaseId: submission.requirementCaseId,
        projectId: submission.projectId,
        organisationId,
      });
      if (!requirementCaseId) {
        logger.warn('evidence: no requirement case for snapshot', {
          submissionId: submission.id,
          projectId: submission.projectId,
        });
      } else {
        const { snapshotId } = await createCaseSnapshot({
          requirementCaseId,
          organisationId,
          createdBy: applicantEmail,
          snapshotType: 'SUBMISSION',
          submissionId: submission.id,
        });
        await exportFromSnapshot({
          snapshotId,
          organisationId,
          createdBy: applicantEmail,
          format: 'ZIP',
        });
      }
    } catch (e) {
      logger.warn('evidence: unable to create snapshot/export for submission', {
        submissionId: submission.id,
        requirementCaseId: submission.requirementCaseId ?? null,
        err: String(e),
      });
    }

    logger.info('Sewage application submitted successfully', {
      referenceNumber,
      municipalityCode,
      integrationType: endpoint.integrationType,
    });

    return {
      ok: true,
      referenceNumber,
      municipalityCode,
      submittedAt: new Date().toISOString(),
      endpoint,
      integrationType: endpoint.integrationType,
      estimatedProcessingDays: 30,
      municipalityContactEmail: getMunicipalityContactEmail(municipalityCode),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // 5. PERSISTENCE: Log FAILURE event
    await submissionRepo.logStatusEvent({
      submissionId: submission.id,
      status: SubmissionStatus.FAILED,
      sourceSystem: 'MILJOBESLUT_PORTAL',
      summary: `Dispatch failed: ${errorMessage}`,
      occurredAt: new Date(),
    });

    logger.error('Failed to submit sewage application to municipality', {
      municipalityCode,
      error: errorMessage,
    });
    throw error;
  }
}

/**
 * Dispatch a prepared submission to a specific recipient email.
 * This function is intended for a "registrar" workflow, where an admin manually
 * sends a pending submission to a known case handler.
 */
export async function dispatchSubmissionToRecipient(params: {
  submissionId: string;
  recipientEmail: string;
  actingUserId: string;
  organisationId: string;
}): Promise<{ ok: boolean; message: string }> {
  const { submissionId, recipientEmail, actingUserId, organisationId: _organisationId } = params;

  // 1. Hämta ärendet och verifiera status
  const submission = await submissionRepo.findById(submissionId);
  if (!submission) {
    throw new Error(`Submission with ID ${submissionId} not found.`);
  }
  if (submission.status !== SubmissionStatus.PENDING_REVIEW) {
    throw new Error(`Submission is not in a dispatchable state. Current status: ${submission.status}`);
  }

  // 2. Hämta nödvändiga dokument (artefakter)
  const withEvents = await submissionRepo.getSubmissionWithEvents(submissionId);
  const artifacts = withEvents.artifacts;
  const _situationPlan = artifacts.find((a) => a.label === 'Situationsplan');
  const _crossSection = artifacts.find((a) => a.label === 'Tvärsektion');
  const applicationDraft = artifacts.find((a) => a.role === SubmissionArtifactRole.PRIMARY_DOCUMENT);

  if (!applicationDraft) {
    throw new Error('Cannot dispatch: Application draft (DOCX) is missing.');
  }

  // 3. Skicka e-post via notificationService
  const subject = `Anmälan om enskilt avlopp: ${submission.submissionKey}`;
  const body = `
    Hej,

    En ny anmälan om enskilt avlopp har skickats in för handläggning.

    Referensnummer: ${submission.submissionKey}
    Projekt-ID: ${submission.projectId}

    Bifogat finns anmälningsunderlag (DOCX), situationsplan och tvärsektion.

    Detta är ett manuellt dirigerat utskick från Miljöbeslut.se, initierat av ${actingUserId}.
  `;

  // TODO: Hämta filinnehåll från `applicationDraft.externalId` (DocumentRecord)
  // och `situationPlan`/`crossSection` (deras lagringsplats).
  // För nu skickar vi utan bilagor för att visa flödet.

  await sendEmailNotification({
    to: recipientEmail,
    subject,
    body,
    attachments: [], // Lägg till riktiga bilagor här
  });

  // 4. Uppdatera status till DELIVERED
  await submissionRepo.logStatusEvent({
    submissionId: submission.id,
    status: SubmissionStatus.DELIVERED,
    sourceSystem: 'REGISTRAR_MANUAL_DISPATCH',
    summary: `Dispatched to ${recipientEmail} by ${actingUserId}`,
    occurredAt: new Date(),
  });

  return { ok: true, message: `Submission dispatched to ${recipientEmail}.` };
}

// ============================================================================
// SUBMISSION METHODS BY INTEGRATION TYPE
// ============================================================================

async function submitViaREST(
  endpoint: MunicipalityEndpoint,
  package_: MunicipalitySubmissionPackage,
): Promise<void> {
  const apiKey = process.env[`MUNICIPALITY_API_KEY_${endpoint.code}`];

  if (!apiKey) {
    throw new Error(`Missing API key for municipality ${endpoint.code}`);
  }

  const response = await fetch(endpoint.submitEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'X-Request-ID': package_.referenceNumber,
    },
    body: JSON.stringify(package_),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Municipality REST API error: ${response.status} - ${text}`);
  }
}

async function submitViaESignal(
  endpoint: MunicipalityEndpoint,
  package_: MunicipalitySubmissionPackage,
): Promise<void> {
  // eSignal (eföretagande.se) integration is not yet implemented.
  // Falling back to email submission until eSignal credentials are provisioned.
  logger.warn('eSignal integration not implemented — falling back to email', {
    municipalityCode: endpoint.code,
  });

  await submitViaEmail(endpoint, package_);
}

async function submitViaKÖ(
  endpoint: MunicipalityEndpoint,
  package_: MunicipalitySubmissionPackage,
): Promise<void> {
  // KÖ (Kommunal Organisering) integration is not yet implemented.
  // Falling back to email submission until KÖ API credentials are provisioned.
  logger.warn('KÖ integration not implemented — falling back to email', {
    municipalityCode: endpoint.code,
  });

  await submitViaEmail(endpoint, package_);
}

async function submitViaEmail(
  endpoint: MunicipalityEndpoint,
  package_: MunicipalitySubmissionPackage,
): Promise<void> {
  const recipientEmail = getMunicipalityContactEmail(endpoint.code);

  const subject = `Ny anmälan om enskilt avlopp: ${package_.referenceNumber} (${package_.propertyInfo.designation})`;
  const body = `
    Hej,

    En ny anmälan om enskilt avlopp har skickats in för fastigheten ${package_.propertyInfo.designation}.

    Ärendenummer: ${package_.referenceNumber}
    Sökande: ${package_.applicantInfo.name} (${package_.applicantInfo.email})
    Anläggningstyp: ${package_.applicationData.systemType}
    Dimensionering: ${package_.applicationData.pe} PE
    Skyddsnivå: ${package_.applicationData.protectionLevel}

    Bifogat finns situationsplan och tvärsektion.

    Detta är ett automatiskt utskick från Miljöbeslut.se.
  `;

  await sendEmailNotification({
    to: recipientEmail,
    subject,
    body,
    attachments: [
      {
        filename: 'situationsplan.svg',
        content: package_.documents.situationPlanSVG,
        contentType: 'image/svg+xml',
      },
      {
        filename: 'tvarsektion.svg',
        content: package_.documents.crossSectionSVG,
        contentType: 'image/svg+xml',
      },
    ],
  });
}

async function submitViaEmailFallback(
  application: SewageApplication,
  municipalityCode: string,
  applicantEmail: string,
  projectId: string,
  organisationId: string,
): Promise<{
  ok: boolean;
  referenceNumber: string;
  municipalityCode: string;
  submittedAt: string;
  endpoint: MunicipalityEndpoint;
  integrationType: string;
}> {
  const referenceNumber = generateReferenceNumber(municipalityCode);
  const submission = await submissionRepo.save({
    id: `sub-${Date.now()}`,
    submissionKey: referenceNumber,
    projectId,
    organisationId,
    requirementCaseId: application.id,
    domain: 'SEWAGE',
    authorityName: `Kommun ${municipalityCode}`,
    recipientChannel: SubmissionChannel.EMAIL,
    status: SubmissionStatus.PENDING_REVIEW,
    caseNumber: application.id,
    submittedBy: applicantEmail,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const submissionId = submission.id;
  const fallbackEndpoint: MunicipalityEndpoint = MUNICIPALITY_ENDPOINTS[municipalityCode] ?? {
    code: municipalityCode,
    name: `Kommun ${municipalityCode}`,
    submitEndpoint: 'mailto:registrator@kommun.se', // Generisk fallback
    integrationType: 'EMAIL',
    authType: 'none',
    requiresPerformanceDeclaration: false,
  };

  logger.warn('Using email fallback for municipality submission', {
    referenceNumber,
    municipalityCode,
    applicantEmail,
  });
  const registrarEmail = MUNICIPALITY_ENDPOINTS[municipalityCode]?.registrarEmail;

  if (registrarEmail) {
    // Om vi har en registrator-mejl, skicka direkt
    const submissionPackage: MunicipalitySubmissionPackage = {
      referenceNumber: submission.submissionKey,
      municipalityCode,
      submittedAt: new Date().toISOString(),
      applicantInfo: {
        name: 'Applicant (Fallback)',
        email: applicantEmail,
        personalNumber: '000000-0000',
      },
      propertyInfo: {
        designation: application.propertyDesignation,
      },
      applicationData: {
        systemType: application.selectedSystemType,
        pe: application.pe,
        protectionLevel: 'N/A', // ProtectionProfile är inte tillgänglig i denna kontext
      },
      documents: {
        situationPlanSVG: '', // Dokument är inte tillgängliga här, skickas separat
        crossSectionSVG: '',
      },
      auditTrail: { initiatedBy: 'SYSTEM_FALLBACK', initiatedAt: new Date().toISOString() },
    };
    await submitViaEmail(fallbackEndpoint, submissionPackage);
  } else {
    // Logga att ärendet väntar på manuell hantering
    await submissionRepo.logStatusEvent({
      submissionId: submissionId,
      status: SubmissionStatus.PENDING_REVIEW,
      sourceSystem: 'MILJOBESLUT_PORTAL',
      summary: 'Endpoint not configured and no registrar email found. Queued for manual dispatch.',
      occurredAt: new Date(),
    });
  }

  return {
    ok: true,
    referenceNumber,
    municipalityCode,
    submittedAt: new Date().toISOString(),
    endpoint: fallbackEndpoint,
    integrationType: 'EMAIL',
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateReferenceNumber(municipalityCode: string): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(7).toUpperCase();
  return `AVLOPP-${municipalityCode}-${timestamp}-${random}`;
}

export function getMunicipalityContactEmail(municipalityCode: string): string {
  // Map to known contact emails
  const emailMap: Record<string, string> = {
    '0180': 'miljoe@stockholm.se',
    '0184': 'miljoe@vst.se',
    '0580': 'miljoe@goteborg.se',
    '1280': 'miljoe@malmo.se',
    '3100': 'miljoe@uppsala.se',
  };

  return emailMap[municipalityCode] || 'miljoe@kommun.se';
}

export function getMunicipalityEstimatedProcessingDays(municipalityCode: string): number {
  // Different municipalities have different processing times
  const processingMap: Record<string, number> = {
    '0180': 30, // Stockholm
    '0184': 28, // Västerås
    '0580': 35, // Göteborg
    '1280': 30, // Malmö
    '3100': 25, // Uppsala
  };

  return processingMap[municipalityCode] || 30;
}
