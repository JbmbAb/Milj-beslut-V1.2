/**
 * LEGAL-ANSWER-PRODUCT-WIRING-01.
 *
 * Frontend client for the canonical governed legal-answer endpoint (POST /api/legal/answer,
 * server/routes/legalAnswer.routes.ts). Uses the same authenticated callApi() pattern already used
 * for other real, authenticated product endpoints (see geo.client.ts's fetchPropertyInfo) --
 * Bearer token + CSRF handled by services/coreApiClient.ts, not reimplemented here.
 *
 * Deliberately never calls /api/legal/search (legacy) or /api/gemini (ungoverned chat).
 */

import { callApi } from '../../../services/coreApiClient';

export type LegalAnswerMode = 'ANSWERED' | 'INSUFFICIENT_EVIDENCE' | 'QUERY_UNDERSPECIFIED' | 'NAMED_SOURCE_NOT_AVAILABLE';
export type LegalFamily = 'law' | 'court' | 'standard';

export interface LegalAnswerCitation {
  citation_id: string;
  fragment_id: string;
  materialization_id: string;
  source_provenance_refs: string[];
  rank: number;
  score: number;
  query_run_identity: string;
}

export interface LegalAnswerClaim {
  text: string;
  citations: LegalAnswerCitation[];
}

export interface LegalAnswerTrace {
  contract_version: string;
  mode: LegalAnswerMode;
  query_run_identity: string;
  context_policy_version: string;
  cited_fragment_ids: string[];
  answer_model_id: string;
  answer_model_version: string;
  answer_pipeline_version: string;
  answer_trace_hash: string;
}

export interface NamedSourceConsistencyInfo {
  verdict: 'NOT_APPLICABLE' | 'CONSISTENT' | 'NAMED_SOURCE_NOT_AVAILABLE';
  named_known_source_ids: string[];
  unrecognized_statute_mentions: string[];
  missing_source_ids: string[];
  reason: string | null;
}

export interface LegalAnswerResponse {
  ok: boolean;
  contract_version: string;
  mode: LegalAnswerMode;
  query_run_identity: string;
  retrieval: { results_count: number | null };
  answer_trace: LegalAnswerTrace;
  query_specificity: { verdict: 'SPECIFIED' | 'UNDERSPECIFIED'; reason: string | null };
  named_source_consistency: NamedSourceConsistencyInfo | null;
  claims: LegalAnswerClaim[];
}

export async function queryLegalAnswer(
  query: string,
  options?: { family?: LegalFamily; topK?: number },
): Promise<LegalAnswerResponse> {
  return callApi<LegalAnswerResponse>('/api/legal/answer', {
    method: 'POST',
    body: {
      query,
      ...(options?.family ? { family: options.family } : {}),
      ...(options?.topK ? { top_k: options.topK } : {}),
    },
  });
}
