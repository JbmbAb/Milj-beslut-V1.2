import { appendDomainAudit } from '../security/auditTrail';

/**
 * auditEvents.ts
 *
 * Tunna wrappers som standardiserar audit för hela beslutskedjan.
 */

export async function auditAiDraftGenerated(input: {
  projectId: string;
  organisationId: string;
  userId: string;
  documentType: string;
  model: string;
  promptHash?: string;
}): Promise<void> {
  await appendDomainAudit({
    entityType: 'AI',
    entityId: input.projectId,
    action: 'AI_DRAFT_GENERATED',
    userId: input.userId,
    payload: input,
  });
}

export async function auditAiRequirementsExtracted(input: {
  projectId: string;
  organisationId: string;
  userId: string;
  activityCode: string;
  count: number;
  model: string;
}): Promise<void> {
  await appendDomainAudit({
    entityType: 'AI',
    entityId: input.projectId,
    action: 'AI_REQUIREMENTS_EXTRACTED',
    userId: input.userId,
    payload: input,
  });
}

export async function auditRequirementChanged(input: {
  requirementId: string;
  projectId: string;
  userId: string;
  change: 'STATUS' | 'FIELDS';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): Promise<void> {
  await appendDomainAudit({
    entityType: 'RequirementRecord',
    entityId: input.requirementId,
    action: input.change === 'STATUS' ? 'REQUIREMENT_STATUS_CHANGED' : 'REQUIREMENT_UPDATED',
    userId: input.userId,
    payload: input,
  });
}

export async function auditSubmissionEvent(input: {
  submissionId: string;
  projectId: string;
  userId: string;
  action: 'SUBMISSION_CREATED' | 'SUBMISSION_SENT';
  payload: Record<string, unknown>;
}): Promise<void> {
  await appendDomainAudit({
    entityType: 'Submission',
    entityId: input.submissionId,
    action: input.action,
    userId: input.userId,
    payload: { projectId: input.projectId, ...input.payload },
  });
}
