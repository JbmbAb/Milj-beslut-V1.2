import { QueryBudgetPolicy, BudgetEvaluation } from './QueryBudgetPolicy';
import { ArtifactReference } from '../../mps-retrieval-governance/src/ArtifactReader';
import { RetrievalExecutionTraceArtifact } from '../../mps-retrieval-trace/src/RetrievalExecutionTraceArtifact';

export class QueryBudgetGuard {
    constructor(private policy: QueryBudgetPolicy) {}

    /**
     * BUD-I02: Selection Stability
     * Evaluates the trace and truncates ONLY expansion if it exceeds budget.
     * Original decision identity or policy selection MUST NOT change.
     */
    evaluateTrace(trace: RetrievalExecutionTraceArtifact): { evaluatedRefs: ArtifactReference[], evaluation: BudgetEvaluation } {
        let status: BudgetEvaluation['status'] = 'OK';
        let truncated = false;
        
        let refs = [...trace.selected_artifact_refs];

        if (refs.length > this.policy.max_refs) {
            refs = refs.slice(0, this.policy.max_refs);
            status = 'RETRIEVAL_TRUNCATED';
            truncated = true;
        }

        if (trace.metadata.estimated_cost > 100) { // Arbitrary cost warning threshold
            status = status === 'RETRIEVAL_TRUNCATED' ? 'RETRIEVAL_TRUNCATED' : 'QUERY_COST_WARNING';
        }

        if (trace.metadata.token_estimate > this.policy.max_tokens) {
            status = 'EXPANSION_LIMIT_REACHED';
            truncated = true;
        }

        return {
            evaluatedRefs: refs,
            evaluation: {
                status,
                truncated
            }
        };
    }
}
