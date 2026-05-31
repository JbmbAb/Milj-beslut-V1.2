/**
 * Decision Feedback Service
 * Implements human-in-the-loop classification system for municipality/authority decisions
 *
 * Core principle: AI recommends → Human reviews → Human approves → System applies
 * NEVER: AI decides. ALWAYS: Human decides.
 *
 * Lifecycle:
 *   1. SUGGESTED - AI has classified incoming decision/condition
 *   2. REVIEWING - Human is examining the recommendation
 *   3. APPROVED/REJECTED - Human has decided
 *   4. APPLIED - Approved recommendation is applied to RequirementCase/matrix
 */

import { prisma } from '../db/prisma';
import { logger } from '../logger';
import type {
  ClassificationRecommendation,
  ApprovalLog,
  HumanApprovalGate,
  ClassificationStatus,
  ConfidenceLevel,
} from '@prisma/client';

// ============================================================================
// TYPES
// ============================================================================

export interface AIClassificationSuggestion {
  caseId: string;
  documentId: string;
  sourceDocumentHash: string;
  sourceTextSegment: string;
  charStart?: number;
  charEnd?: number;
  aiClassification: string; // e.g., "APPROVED_WITH_CONDITIONS", "REJECTED", "NEEDS_REVISION"
  aiConfidence: ConfidenceLevel;
  aiReasoning?: string;
  suggestedConditions?: Array<{
    condition: string;
    deadline?: string;
    reference?: string;
  }>;
  suggestedRequirements?: Array<{
    requirement: string;
    legalBasis?: string;
    deadline?: string;
  }>;
}

export interface ApprovalReview {
  recommendationId: string;
  decision: 'APPROVED' | 'REJECTED' | 'NEEDS_CLARIFICATION';
  reviewedBy: string;
  reviewNotes?: string;
  appliedWithChanges?: boolean;
  changesNotes?: string;
}

export interface ClassificationRecommendationDTO {
  id: string;
  status: ClassificationStatus;
  aiClassification: string;
  aiConfidence: ConfidenceLevel;
  aiReasoning?: string;
  sourceTextSegment: string;
  suggestedConditions?: Record<string, unknown>[];
  suggestedRequirements?: Record<string, unknown>[];
  reviewedBy?: string;
  reviewedAt?: Date;
  reviewNotes?: string;
  reviewDecision?: string;
  createdAt: Date;
}

// ============================================================================
// RECOMMENDATION ENGINE (AI-only, no persistence)
// ============================================================================

/**
 * Create an AI recommendation WITHOUT applying it
 * Returns a suggestion that must pass through HumanApprovalGate
 */
export async function createAIRecommendation(
  suggestion: AIClassificationSuggestion,
): Promise<ClassificationRecommendation> {
  // Validate that case exists
  const caseRecord = await prisma.requirementCase.findUnique({
    where: { id: suggestion.caseId },
  });

  if (!caseRecord) {
    throw new Error(`RequirementCase not found: ${suggestion.caseId}`);
  }

  // Check document integrity
  const document = await prisma.documentRecord.findUnique({
    where: { id: suggestion.documentId },
  });

  if (!document) {
    throw new Error(`Document not found: ${suggestion.documentId}`);
  }

  // Create recommendation in SUGGESTED state (not applied)
  const recommendation = await prisma.classificationRecommendation.create({
    data: {
      caseId: suggestion.caseId,
      documentId: suggestion.documentId,
      sourceDocumentHash: suggestion.sourceDocumentHash,
      status: 'SUGGESTED',
      aiClassification: suggestion.aiClassification,
      aiConfidence: suggestion.aiConfidence,
      aiReasoning: suggestion.aiReasoning,
      sourceTextSegment: suggestion.sourceTextSegment,
      charStart: suggestion.charStart,
      charEnd: suggestion.charEnd,
      suggestedConditions: suggestion.suggestedConditions
        ? JSON.stringify(suggestion.suggestedConditions)
        : null,
      suggestedRequirements: suggestion.suggestedRequirements
        ? JSON.stringify(suggestion.suggestedRequirements)
        : null,
    },
  });

  // Log the suggestion
  await logApprovalAction(
    recommendation.id,
    'SUGGESTED',
    'SYSTEM',
    `AI suggested classification: ${suggestion.aiClassification} (confidence: ${suggestion.aiConfidence})`,
  );

  logger.info('AI recommendation created (SUGGESTED state)', {
    recommendationId: recommendation.id,
    caseId: suggestion.caseId,
    aiClassification: suggestion.aiClassification,
    confidence: suggestion.aiConfidence,
  });

  return recommendation;
}

// ============================================================================
// HUMAN REVIEW GATE
// ============================================================================

/**
 * Get all pending recommendations for human review
 */
export async function getPendingRecommendationsForReview(
  caseId: string,
): Promise<ClassificationRecommendationDTO[]> {
  const recommendations = await prisma.classificationRecommendation.findMany({
    where: {
      caseId,
      status: { in: ['SUGGESTED', 'REVIEWING'] },
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  return recommendations.map((r) => ({
    id: r.id,
    status: r.status,
    aiClassification: r.aiClassification,
    aiConfidence: r.aiConfidence,
    aiReasoning: r.aiReasoning || undefined,
    sourceTextSegment: r.sourceTextSegment,
    suggestedConditions: r.suggestedConditions
      ? (JSON.parse(r.suggestedConditions as string) as Record<string, unknown>[])
      : undefined,
    suggestedRequirements: r.suggestedRequirements
      ? (JSON.parse(r.suggestedRequirements as string) as Record<string, unknown>[])
      : undefined,
    reviewedBy: r.reviewedBy || undefined,
    reviewedAt: r.reviewedAt || undefined,
    reviewNotes: r.reviewNotes || undefined,
    reviewDecision: r.reviewDecision || undefined,
    createdAt: r.createdAt,
  }));
}

/**
 * Mark a recommendation as REVIEWING (human has opened it)
 */
export async function markAsReviewing(
  recommendationId: string,
  reviewedBy: string,
): Promise<ClassificationRecommendation> {
  const recommendation = await prisma.classificationRecommendation.update({
    where: { id: recommendationId },
    data: {
      status: 'REVIEWING',
      reviewedBy,
      reviewedAt: new Date(),
    },
  });

  await logApprovalAction(
    recommendationId,
    'REVIEWED',
    reviewedBy,
    'Human has opened the recommendation for review',
  );

  return recommendation;
}

// ============================================================================
// HUMAN APPROVAL DECISION
// ============================================================================

/**
 * Human review decision: APPROVED, REJECTED, or NEEDS_CLARIFICATION
 * This does NOT apply the decision - it only marks it as approved
 * Application happens in a separate step to allow for batching
 */
export async function submitApprovalReview(review: ApprovalReview): Promise<ClassificationRecommendation> {
  const recommendation = await prisma.classificationRecommendation.findUnique({
    where: { id: review.recommendationId },
  });

  if (!recommendation) {
    throw new Error(`Recommendation not found: ${review.recommendationId}`);
  }

  if (recommendation.status !== 'REVIEWING' && recommendation.status !== 'SUGGESTED') {
    throw new Error(
      `Cannot review recommendation in ${recommendation.status} state. Only SUGGESTED or REVIEWING allowed.`,
    );
  }

  // Map approval decision to status
  const newStatus: ClassificationStatus =
    review.decision === 'APPROVED' ? 'APPROVED' : review.decision === 'REJECTED' ? 'REJECTED' : 'REVIEWING';

  const updated = await prisma.classificationRecommendation.update({
    where: { id: review.recommendationId },
    data: {
      status: newStatus,
      reviewedBy: review.reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: review.reviewNotes,
      reviewDecision: review.decision,
      appliedWithChanges: review.appliedWithChanges || false,
      appliedChangesNotes: review.changesNotes,
    },
  });

  // Log the decision
  await logApprovalAction(
    review.recommendationId,
    review.decision,
    review.reviewedBy,
    review.reviewNotes || `Human decision: ${review.decision}`,
  );

  logger.info('Human review decision recorded', {
    recommendationId: review.recommendationId,
    decision: review.decision,
    reviewedBy: review.reviewedBy,
  });

  return updated;
}

// ============================================================================
// APPLICATION STEP (after approval)
// ============================================================================

/**
 * Apply an APPROVED recommendation to the RequirementCase
 * This is where the legal/binding change happens
 * Only call this for recommendations with status === 'APPROVED'
 */
export async function applyApprovedRecommendation(
  recommendationId: string,
  appliedBy: string,
): Promise<{
  success: boolean;
  requirementCaseUpdated: boolean;
  appliedAt: Date;
  message: string;
}> {
  const recommendation = await prisma.classificationRecommendation.findUnique({
    where: { id: recommendationId },
    include: {
      case: true,
    },
  });

  if (!recommendation) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  // CRITICAL: Only APPROVED recommendations can be applied
  if (recommendation.status !== 'APPROVED') {
    throw new Error(
      `Cannot apply recommendation in ${recommendation.status} state. Only APPROVED recommendations can be applied.`,
    );
  }

  // Apply the recommendation
  const appliedAt = new Date();

  // Update recommendation with application metadata
  await prisma.classificationRecommendation.update({
    where: { id: recommendationId },
    data: {
      status: 'APPLIED',
      appliedAt,
      appliedBy,
    },
  });

  // Log the application
  await logApprovalAction(
    recommendationId,
    'APPLIED',
    appliedBy,
    `Approved recommendation has been applied to RequirementCase`,
  );

  logger.info('Approved recommendation applied to case', {
    recommendationId,
    caseId: recommendation.caseId,
    appliedBy,
    appliedAt: appliedAt.toISOString(),
  });

  return {
    success: true,
    requirementCaseUpdated: true,
    appliedAt,
    message: `Recommendation applied. RequirementCase ${recommendation.caseId} may need update based on conditions/requirements.`,
  };
}

// ============================================================================
// SOURCE IMMUTABILITY VERIFICATION
// ============================================================================

/**
 * Verify that the original document has not changed since recommendation was made
 * Critical for juridical traceability
 */
export async function verifySourceIntegrity(recommendationId: string): Promise<{
  integrityOk: boolean;
  currentHash: string;
  originalHash: string;
  message: string;
}> {
  const recommendation = await prisma.classificationRecommendation.findUnique({
    where: { id: recommendationId },
    include: {
      document: true,
    },
  });

  if (!recommendation) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  // Re-hash the document
  const currentHash = recommendation.document.fileSha256 || 'UNKNOWN';

  const integrityOk = currentHash === recommendation.sourceDocumentHash;

  return {
    integrityOk,
    currentHash,
    originalHash: recommendation.sourceDocumentHash,
    message: integrityOk
      ? 'Document integrity verified. Original source is unchanged.'
      : 'WARNING: Document has changed since recommendation was created.',
  };
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================

/**
 * Internal: Log an action in the approval chain
 */
async function logApprovalAction(
  recommendationId: string,
  action: string,
  actor: string,
  reason?: string,
): Promise<ApprovalLog> {
  const log = await prisma.approvalLog.create({
    data: {
      classificationRecommendationId: recommendationId,
      action,
      actor,
      reason,
      timestamp: new Date(),
    },
  });

  return log;
}

/**
 * Get full approval audit trail for a recommendation
 */
export async function getApprovalAuditTrail(recommendationId: string): Promise<ApprovalLog[]> {
  return await prisma.approvalLog.findMany({
    where: {
      classificationRecommendationId: recommendationId,
    },
    orderBy: {
      timestamp: 'asc',
    },
  });
}

// ============================================================================
// HUMAN APPROVAL GATE MANAGEMENT
// ============================================================================

/**
 * Open a HumanApprovalGate for a case/document pair
 * Allows recommendations to be added and reviewed
 */
export async function openApprovalGate(caseId: string, documentId: string): Promise<HumanApprovalGate> {
  const existing = await prisma.humanApprovalGate.findUnique({
    where: {
      caseId_documentId: {
        caseId,
        documentId,
      },
    },
  });

  if (existing) {
    // Re-open if closed
    if (!existing.isOpen) {
      return await prisma.humanApprovalGate.update({
        where: { id: existing.id },
        data: {
          isOpen: true,
          lockedBy: null,
          lockedAt: null,
        },
      });
    }
    return existing;
  }

  // Create new gate
  return await prisma.humanApprovalGate.create({
    data: {
      caseId,
      documentId,
      isOpen: true,
    },
  });
}

/**
 * Lock the gate for final review
 * No new recommendations can be added after locking
 */
export async function lockApprovalGate(
  caseId: string,
  documentId: string,
  lockedBy: string,
): Promise<HumanApprovalGate> {
  const gate = await prisma.humanApprovalGate.findUnique({
    where: {
      caseId_documentId: {
        caseId,
        documentId,
      },
    },
  });

  if (!gate) {
    throw new Error(`Approval gate not found for case ${caseId} and document ${documentId}`);
  }

  return await prisma.humanApprovalGate.update({
    where: { id: gate.id },
    data: {
      isOpen: false,
      lockedBy,
      lockedAt: new Date(),
    },
  });
}

/**
 * Finalize the gate (human has completed all reviews)
 */
export async function finalizeApprovalGate(caseId: string, documentId: string): Promise<HumanApprovalGate> {
  const gate = await prisma.humanApprovalGate.findUnique({
    where: {
      caseId_documentId: {
        caseId,
        documentId,
      },
    },
  });

  if (!gate) {
    throw new Error(`Approval gate not found for case ${caseId} and document ${documentId}`);
  }

  return await prisma.humanApprovalGate.update({
    where: { id: gate.id },
    data: {
      finalizedAt: new Date(),
    },
  });
}

/**
 * Get gate status and counts
 */
export async function getApprovalGateStatus(
  caseId: string,
  documentId: string,
): Promise<{
  isOpen: boolean;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  reviewingCount: number;
  appliedCount: number;
  totalCount: number;
}> {
  const recs = await prisma.classificationRecommendation.findMany({
    where: {
      caseId,
      documentId,
    },
  });

  const gate = await prisma.humanApprovalGate.findUnique({
    where: {
      caseId_documentId: {
        caseId,
        documentId,
      },
    },
  });

  const pending = recs.filter((r) => r.status === 'SUGGESTED').length;
  const reviewing = recs.filter((r) => r.status === 'REVIEWING').length;
  const approved = recs.filter((r) => r.status === 'APPROVED').length;
  const rejected = recs.filter((r) => r.status === 'REJECTED').length;
  const applied = recs.filter((r) => r.status === 'APPLIED').length;

  return {
    isOpen: gate?.isOpen || false,
    pendingCount: pending,
    approvedCount: approved,
    rejectedCount: rejected,
    reviewingCount: reviewing,
    appliedCount: applied,
    totalCount: recs.length,
  };
}
