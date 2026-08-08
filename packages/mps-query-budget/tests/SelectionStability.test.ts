import { describe, it, expect } from 'vitest';
import { QueryBudgetGuard } from '../src/QueryBudgetGuard';
import { RetrievalExecutionTraceArtifact } from '../../mps-retrieval-trace/src/RetrievalExecutionTraceArtifact';

describe('BUD-I02: Selection Stability', () => {

  it('Budget should truncate refs if limit is exceeded, but preserve original ordering and types', () => {
    const trace: RetrievalExecutionTraceArtifact = {
      trace_hash: 'abc',
      query_hash: 'q1',
      policy_version: 'v1',
      artifact_snapshot_ref: 'snap1',
      selected_artifact_refs: [
        { id: '1', artifact_class: 'DecisionImpactArtifact' },
        { id: '2', artifact_class: 'DecisionImpactArtifact' },
        { id: '3', artifact_class: 'SpatialEvidenceArtifact' },
        { id: '4', artifact_class: 'SpatialEvidenceArtifact' }
      ],
      metadata: {
        executed_at: 'now',
        duration_ms: 10,
        estimated_cost: 50,
        token_estimate: 500,
        node_id: 'node_1'
      }
    };

    const guardUnlimited = new QueryBudgetGuard({ max_refs: 10, max_tokens: 1000, max_latency_ms: 500 });
    const { evaluatedRefs: refsUnlim, evaluation: evalUnlim } = guardUnlimited.evaluateTrace(trace);
    expect(refsUnlim.length).toBe(4);
    expect(evalUnlim.status).toBe('OK');

    const guardLimited = new QueryBudgetGuard({ max_refs: 2, max_tokens: 1000, max_latency_ms: 500 });
    const { evaluatedRefs: refsLim, evaluation: evalLim } = guardLimited.evaluateTrace(trace);
    
    // Only expansion is cut. The top results (1 and 2) are kept.
    expect(refsLim.length).toBe(2);
    expect(refsLim[0].id).toBe('1');
    expect(refsLim[1].id).toBe('2');
    expect(evalLim.status).toBe('RETRIEVAL_TRUNCATED');
  });

});
