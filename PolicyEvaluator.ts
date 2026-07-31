import { ExecutionManifest } from '../identity/ExecutionManifest';
import { RegistryReference } from '../types';

export type PolicyDecisionStatus = 'ALLOW' | 'DENY' | 'REQUIRE_APPROVAL';

export interface PolicyDecision {
  status: PolicyDecisionStatus;
  blockingPolicy?: RegistryReference;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface PolicyEvaluator {
  evaluate(manifest: ExecutionManifest, executionPlan: unknown): Promise<PolicyDecision>;
}
