import crypto from 'node:crypto';
import { appendDomainAudit } from '../security/auditTrail';
import { logger } from '../logger';
import {
  submitToConfiguredAuthority,
  type PermitAuthorityFailureMode,
  type PermitAuthorityStatus,
} from './permitAuthorityAdapter';

export type AuthoritySubmitStatus = PermitAuthorityStatus;

export interface AuthoritySubmission {
  referenceId: string;
  caseNumber: string;
  submittedAt: string;
  authority: string;
  status: AuthoritySubmitStatus;
  auditId: string;
  externalRef?: string;
  providerMode: 'mock' | 'external';
  responseCode: number | null;
  rawStatus: string | null;
  failureMode: PermitAuthorityFailureMode;
}

const submissions = new Map<string, AuthoritySubmission>();

function generateCaseNumber(orgId: string): string {
  const year = new Date().getFullYear();
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  const orgPrefix = orgId.slice(0, 4).toUpperCase();
  return `LST-${year}-${orgPrefix}-${rand}`;
}

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
  const referenceId = crypto.randomUUID();
  const caseNumber = generateCaseNumber(params.orgId);
  const submittedAt = new Date().toISOString();
  const authority = params.authorityName ?? 'Lansstyrelsen';

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

  const submission: AuthoritySubmission = {
    referenceId,
    caseNumber,
    submittedAt,
    authority,
    status: adapterResult.status,
    auditId: auditRecord.id,
    externalRef: adapterResult.externalRef,
    providerMode: adapterResult.providerMode,
    responseCode: adapterResult.responseCode,
    rawStatus: adapterResult.rawStatus,
    failureMode: adapterResult.failureMode,
  };

  submissions.set(referenceId, submission);
  logger.info('permit-authority: submission created', {
    referenceId,
    caseNumber,
    status: submission.status,
    providerMode: submission.providerMode,
    responseCode: submission.responseCode,
    failureMode: submission.failureMode,
  });

  return submission;
}

export function getSubmission(referenceId: string): AuthoritySubmission | undefined {
  return submissions.get(referenceId);
}

export function listSubmissionsForProject(_projectId: string): AuthoritySubmission[] {
  return Array.from(submissions.values());
}
