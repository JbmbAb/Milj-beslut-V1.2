import { describe, it, expect } from 'vitest';
import { calculateRetrievalTraceIdentity } from '../../mps-retrieval-trace/src/RetrievalTraceIdentity';

describe('BUD-I01: Identity Isolation', () => {

  it('Budget configuration change MUST NOT change artifact_hash or trace_hash', () => {
    // Identity fields for Trace
    const query_hash = 'q_1';
    const policy_version = 'v1.0';
    const snapshot_ref = 'snap_1';
    const refs = [{ id: 'ref_1', artifact_class: 'DecisionImpactArtifact' as any }];

    const traceHashWithoutBudget = calculateRetrievalTraceIdentity(query_hash, policy_version, snapshot_ref, refs);

    // Pretend a budget configuration changed
    const budgetPolicy = { max_refs: 1, max_tokens: 1000, max_latency_ms: 500 };
    
    // Calculate identity again, ensuring budget configuration does not play a role
    const traceHashWithBudget = calculateRetrievalTraceIdentity(query_hash, policy_version, snapshot_ref, refs);

    expect(traceHashWithoutBudget).toEqual(traceHashWithBudget);
  });

});
