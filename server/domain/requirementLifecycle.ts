import { z } from 'zod';

/**
 * requirementLifecycle.ts (LOCKED)
 *
 * Kodifierad livscykel + övergångar. Används som release gate och av routes
 * som uppdaterar requirements.
 */

export const requirementSourceSchema = z.enum(['AI_EXTRACTED', 'AUTHORITY', 'GIS_RULE', 'MANUAL']);
export type RequirementSource = z.infer<typeof requirementSourceSchema>;

export const requirementStatusSchema = z.enum([
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUPERSEDED',
  'CLOSED',
]);
export type RequirementStatus = z.infer<typeof requirementStatusSchema>;

export interface RequirementLifecycleState {
  status: RequirementStatus;
  source: RequirementSource;
  version: number;
  systemLocked: boolean;
}

const TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  // NOTE: fast-track DRAFT -> APPROVED is allowed when citations/verifiedBy rules pass.
  DRAFT: ['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'CLOSED'],
  IN_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['APPROVED', 'SUPERSEDED', 'CLOSED'],
  REJECTED: ['REJECTED', 'DRAFT', 'CLOSED'],
  SUPERSEDED: ['SUPERSEDED', 'CLOSED'],
  CLOSED: ['CLOSED'],
};

export function canTransition(from: RequirementStatus, to: RequirementStatus): boolean {
  return (TRANSITIONS[from] || []).includes(to);
}

export function assertTransitionAllowed(input: {
  current: RequirementLifecycleState;
  nextStatus: RequirementStatus;
  actor: { kind: 'system' | 'user' | 'ai' };
}): void {
  const { current, nextStatus, actor } = input;
  if (current.status === nextStatus) {
    // No-op status updates are allowed (metadata updates handled elsewhere).
    return;
  }
  if (current.systemLocked && actor.kind !== 'system') {
    throw new Error('REQUIREMENT_LOCKED: Requirement is system-locked.');
  }
  if (!canTransition(current.status, nextStatus)) {
    throw new Error(`REQUIREMENT_INVALID_TRANSITION: ${current.status} -> ${nextStatus}`);
  }
  // AI får inte göra bindande övergångar
  if (actor.kind === 'ai' && (nextStatus === 'APPROVED' || nextStatus === 'CLOSED')) {
    throw new Error('REQUIREMENT_AI_FORBIDDEN: AI cannot approve/close requirements.');
  }
}
