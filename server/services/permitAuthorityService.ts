/**
 * permitAuthorityService.ts
 *
 * Digital inlämning av tillståndsansökan till länsstyrelse / kommunen.
 *
 * Flödet:
 *   1. Klient anropar POST /api/projects/:projectId/permit/authority-submit
 *   2. Tjänsten skapar ett unikt diarienummer (referensnummer)
 *   3. Ansökan registreras i AuditTrail med hash-chain
 *   4. Om AUTHORITY_SUBMIT_ENDPOINT är konfigurerat görs ett riktigt API-anrop;
 *      annars markeras inlämningen som ej konfigurerad utan att skapa mock-kvittens
 *
 * Miljövariabler (valfria):
 *   AUTHORITY_SUBMIT_ENDPOINT  — URL till myndighetens API (t.ex. länsstyrelsen eSTA)
 *   AUTHORITY_API_KEY          — API-nyckel till myndighetsystemet
 */

import crypto from 'node:crypto';
import { appendDomainAudit } from '../security/auditTrail';
import { logger } from '../logger';
import {
  createCaseSnapshot,
  exportFromSnapshot,
  resolveRequirementCaseIdForProject,
} from '../modules/evidence/public';
import { submitToConfiguredAuthority } from './permitAuthorityAdapter';
import { auditSubmissionEvent } from './auditEvents';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuthoritySubmitStatus = 'SUBMITTED' | 'RECEIVED' | 'PENDING_REVIEW' | 'REJECTED' | 'PENDING';

export interface AuthoritySubmission {
  referenceId: string;
  caseNumber: string;
  submittedAt: string;
  authority: string;
  status: AuthoritySubmitStatus;
  auditId: string;
  externalRef?: string;
  providerMode: 'unconfigured' | 'external' | 'mock';
  failureMode: 'missing_endpoint' | 'http_4xx' | 'http_5xx' | 'timeout' | 'network' | null;
  responseCode: number | null;
}

// ─── In-process submission log ────────────────────────────────────────────────

const submissions = new Map<string, AuthoritySubmission>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateCaseNumber(orgId: string): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  const orgPrefix = orgId.slice(0, 4).toUpperCase();
  return `LST-${year}-${orgPrefix}-${rand}`;
}

// ─── Main service function ────────────────────────────────────────────────────

/**
 * Skicka in en tillståndsansökan till behörig myndighet.
 */
export async function submitPermitToAuthority(params: {
  projectId: string;
  orgId: string;
  actingUserId: string;
  permitType: string;
  applicantName: string;
  propertyDesignation: string;
  documentIds: string[];
  authorityName?: string;
}): Promise<AuthoritySubmission> {
  // Utan AUTHORITY_SUBMIT_ENDPOINT returnerar vi istället ett spårbart
  // PENDING_REVIEW-resultat via adaptern (providerMode = 'unconfigured'
  // eller 'mock' om AUTHORITY_MOCK_MODE=true). Detta ersätter tidigare
  // hård throw som blockerade både demo- och test-flöden.

  const referenceId = crypto.randomUUID();
  const caseNumber = generateCaseNumber(params.orgId);
  const submittedAt = new Date().toISOString();
  const authority = params.authorityName ?? 'Länsstyrelsen';

  // Log to AuditTrail first — always persists regardless of external call
  const auditRecord = await appendDomainAudit({
    entityType: 'PERMIT_SUBMISSION',
    entityId: referenceId,
    action: 'PERMIT_SUBMITTED_TO_AUTHORITY',
    userId: params.actingUserId,
    payload: {
      projectId: params.projectId,
      orgId: params.orgId,
      caseNumber,
      permitType: params.permitType,
      applicantName: params.applicantName,
      propertyDesignation: params.propertyDesignation,
      documentIds: params.documentIds,
      authority,
      submittedAt,
    },
  });
  await auditSubmissionEvent({
    submissionId: referenceId,
    projectId: params.projectId,
    userId: params.actingUserId,
    action: 'SUBMISSION_CREATED',
    payload: {
      orgId: params.orgId,
      authority,
      permitType: params.permitType,
      caseNumber,
      documentIds: params.documentIds,
      submittedAt,
    },
  }).catch(() => undefined);

  // Try external authority API if configured
  let status: AuthoritySubmitStatus = 'PENDING';
  let providerMode: 'unconfigured' | 'external' | 'mock' = 'unconfigured';
  let failureMode: AuthoritySubmission['failureMode'] = null;
  let responseCode: number | null = null;

  const adapterResult = await submitToConfiguredAuthority({
    referenceId,
    caseNumber,
    submittedAt,
    projectId: params.projectId,
    orgId: params.orgId,
    authority,
    permitType: params.permitType,
    applicantName: params.applicantName,
    propertyDesignation: params.propertyDesignation,
    documentIds: params.documentIds,
  });

  providerMode = adapterResult.providerMode;
  status = adapterResult.status;
  const externalRef = adapterResult.externalRef;
  responseCode = adapterResult.responseCode;
  failureMode = adapterResult.failureMode;

  if (providerMode === 'external' && failureMode === 'http_4xx' && responseCode !== null) {
    logger.warn('permit-authority: external submit failed', { status: responseCode });
  }
  if (providerMode === 'external' && (failureMode === 'http_5xx' || failureMode === 'network')) {
    logger.warn('permit-authority: external endpoint unreachable', {
      err: failureMode === 'network' ? 'network failure' : `HTTP ${responseCode ?? 'unknown'}`,
    });
  }
  if (providerMode === 'external' && failureMode === 'timeout') {
    logger.warn('permit-authority: external endpoint unreachable', { err: 'AbortError: timed out' });
  }

  const submission: AuthoritySubmission = {
    referenceId,
    caseNumber,
    submittedAt,
    authority,
    status,
    auditId: auditRecord.id,
    externalRef,
    providerMode,
    failureMode,
    responseCode,
  };
  if (providerMode === 'external' || providerMode === 'mock' || providerMode === 'unconfigured') {
    await auditSubmissionEvent({
      submissionId: referenceId,
      projectId: params.projectId,
      userId: params.actingUserId,
      action: 'SUBMISSION_SENT',
      payload: {
        providerMode,
        status,
        failureMode,
        responseCode,
        externalRef: externalRef ?? null,
      },
    }).catch(() => undefined);

    // Evidence chain efter inlämning: snapshot + export (ingen Submission-rad i DB för den här flöden).
    try {
      const requirementCaseId = await resolveRequirementCaseIdForProject({
        projectId: params.projectId,
        organisationId: params.orgId,
      });
      if (requirementCaseId) {
        const { snapshotId } = await createCaseSnapshot({
          requirementCaseId,
          organisationId: params.orgId,
          createdBy: params.actingUserId,
          snapshotType: 'SUBMISSION',
        });
        await exportFromSnapshot({
          snapshotId,
          organisationId: params.orgId,
          createdBy: params.actingUserId,
          format: 'ZIP',
        });
      }
    } catch (e) {
      logger.warn('evidence: permit authority snapshot/export failed', {
        projectId: params.projectId,
        err: String(e),
      });
    }
  }

  submissions.set(referenceId, submission);
  logger.info('permit-authority: submission created', { referenceId, caseNumber, status });

  return submission;
}

/**
 * Hämta status för en specifik inlämning.
 */
export function getSubmission(referenceId: string): AuthoritySubmission | undefined {
  return submissions.get(referenceId);
}

/**
 * Lista alla inlämningar för ett projekt.
 */
export function listSubmissionsForProject(_projectId: string): AuthoritySubmission[] {
  // In production, filter by projectId stored on each submission.
  // Here we return all (the projectId is in the audit trail payload).
  return Array.from(submissions.values());
}
