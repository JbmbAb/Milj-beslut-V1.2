/** MIMER-BUD invariant ids (ADR-MPS-QUERY-BUDGET). */
export const MIMER_BUD_I01 = "MIMER-BUD-I01" as const;
export const MIMER_BUD_I02 = "MIMER-BUD-I02" as const;
export const MIMER_BUD_I03 = "MIMER-BUD-I03" as const;
export const MIMER_BUD_I04 = "MIMER-BUD-I04" as const;
export const MIMER_BUD_I05 = "MIMER-BUD-I05" as const;
export const MIMER_BUD_I06 = "MIMER-BUD-I06" as const;
export const MIMER_BUD_I07 = "MIMER-BUD-I07" as const;

export interface QueryBudgetPolicy {
    max_refs: number;
    max_tokens: number;
    max_latency_ms: number;
}

export type BudgetStatus = 
    | 'OK'
    | 'QUERY_COST_WARNING'
    | 'EXPANSION_LIMIT_REACHED'
    | 'RETRIEVAL_TRUNCATED'
    | 'PARTIAL';

export type PartialBudgetReason = 'QUERY_BUDGET_SOFT_LIMIT';

export interface BudgetEvaluation {
    status: BudgetStatus;
    truncated: boolean;
    /** BUD-I07: incompleteness MUST be explicit when status is PARTIAL. */
    incompleteness_declared?: boolean;
    reason?: PartialBudgetReason;
}
