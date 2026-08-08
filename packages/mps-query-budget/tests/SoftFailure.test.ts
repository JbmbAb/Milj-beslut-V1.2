import { describe, it, expect } from 'vitest';
import { QueryBudgetGuard } from '../src/QueryBudgetGuard';
import { RetrievalExecutionTraceArtifact } from '../../mps-retrieval-trace/src/RetrievalExecutionTraceArtifact';

describe('BUD-I03: Soft Failure', () => {

  it('Budget violations should yield warnings and truncations, not throw hard errors', () => {
    const trace: RetrievalExecutionTraceArtifact = {
      trace_hash: 'abc',
      query_hash: 'q1',
      policy_version: 'v1',
      artifact_snapshot_ref: 'snap1',
      selected_artifact_refs: [
        { id: '1', artifact_class: 'DecisionImpactArtifact' }
      ],
      metadata: {
        executed_at: 'now',
        duration_ms: 10,
        estimated_cost: 200, // Costs a lot
        token_estimate: 5000, // Too many tokens
        node_id: 'node_1'
      }
    };

    const guard = new QueryBudgetGuard({ max_refs: 10, max_tokens: 1000, max_latency_ms: 500 });
    
    // Should NOT throw an error
    let result;
    expect(() => {
        result = guard.evaluateTrace(trace);
    }).not.toThrow();

    // Should indicate soft failure state
    expect(result!.evaluation.status).toBe('EXPANSION_LIMIT_REACHED');
    expect(result!.evaluation.truncated).toBe(true);
  });

});
