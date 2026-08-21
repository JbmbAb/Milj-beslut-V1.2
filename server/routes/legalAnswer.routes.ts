/**
 * LEGAL-ANSWER-PRODUCT-WIRING-01.
 *
 * The canonical HTTP boundary over the governed answer chain (composeLegalAnswer). Mirrors
 * server/routes/legalRetrieval.routes.ts's auth/rate-limit/validation pattern exactly. Deliberately
 * thin: validate input, authorize, call composeLegalAnswer(), serialize a versioned DTO. No
 * retrieval, gate, or citation logic lives here -- everything already proven in
 * LegalAnswerComposition.ts, LawSourceRouter.ts, and mps-legal-answer-contract runs unmodified.
 *
 * This route explicitly does NOT call, import, or otherwise reach: /api/legal/search,
 * searchLegalCorpusHandler, searchLegalCorpusTool, or /api/gemini -- those are the legacy/bypass
 * surfaces the LEGAL-ANSWER-PRODUCT-CONVERGENCE-01 trace found, and this unit's whole purpose is to
 * give the product a real path to the ALREADY-PROVEN canonical chain instead of touching them.
 *
 * Every field the composed chain already produces for provenance/citation (fragment_id,
 * materialization_id, source_provenance_refs, rank, score, citation_id, query_run_identity) is
 * passed straight through -- this layer never reconstructs, summarizes, or "improves" a citation.
 */
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import { createLegalAnswerComposition, composeLegalAnswer } from '../modules/legal/answer/LegalAnswerComposition';
import { createLegalRetrievalComposition } from '../modules/legal/retrieval/LegalRetrievalComposition';

const router = express.Router();

export const LEGAL_ANSWER_SERVING_CONTRACT_VERSION = 'legal-answer-serving-v1';

const RequestSchema = z.object({
  query: z.string().min(2).max(500),
  family: z.enum(['law', 'court', 'standard']).optional(),
  top_k: z.number().int().min(1).max(50).optional(),
});

// POST /api/legal/answer -- the canonical governed answer endpoint. Not to be confused with the
// legacy POST /api/legal/search (legal.routes.ts, hybrid+rerank over the OLD legal_corpus_chunks
// table) or the retrieval-only POST /api/legal/retrieval/search (legalRetrieval.routes.ts).
router.post(
  '/api/legal/answer',
  requireAuth,
  rateLimitByUser(20, 60_000),
  async (req: Request, res: Response) => {
    try {
      const parsed = RequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Invalid request', details: parsed.error.flatten() });
        return;
      }
      const { query, family, top_k } = parsed.data;

      const retrievalDeps = createLegalRetrievalComposition();
      const deps = createLegalAnswerComposition(retrievalDeps);
      const outcome = await composeLegalAnswer({ query, family, topK: top_k }, deps);

      res.json({
        ok: true,
        contract_version: LEGAL_ANSWER_SERVING_CONTRACT_VERSION,
        mode: outcome.mode,
        query_run_identity: outcome.answerTrace.query_run_identity,
        // A thin, honest observability field -- not part of the citation/provenance contract, just
        // the retrieval result count already computed by composeLegalAnswer. Since the single-query
        // path always caps at the requested topK and the multi-source budget path (2+ recognized
        // candidates) can exceed it, this alone is real evidence of which retrieval path a given
        // request actually took -- used by LEGAL-ANSWER-PRODUCT-WIRING-01's runtime proof to show
        // reachability, not just that the code exists.
        retrieval: { results_count: outcome.retrieval?.results.length ?? null },
        answer_trace: {
          contract_version: outcome.answerTrace.contract_version,
          mode: outcome.answerTrace.mode,
          query_run_identity: outcome.answerTrace.query_run_identity,
          context_policy_version: outcome.answerTrace.context_policy_version,
          cited_fragment_ids: outcome.answerTrace.cited_fragment_ids,
          answer_model_id: outcome.answerTrace.answer_model_id,
          answer_model_version: outcome.answerTrace.answer_model_version,
          answer_pipeline_version: outcome.answerTrace.answer_pipeline_version,
          answer_trace_hash: outcome.answerTrace.answer_trace_hash,
        },
        query_specificity: {
          verdict: outcome.querySpecificity.verdict,
          reason: outcome.querySpecificity.reason,
        },
        named_source_consistency: outcome.namedSourceConsistency
          ? {
              verdict: outcome.namedSourceConsistency.verdict,
              named_known_source_ids: outcome.namedSourceConsistency.named_known_source_ids,
              unrecognized_statute_mentions: outcome.namedSourceConsistency.unrecognized_statute_mentions,
              missing_source_ids: outcome.namedSourceConsistency.missing_source_ids,
              reason: outcome.namedSourceConsistency.reason,
            }
          : null,
        // Provenance identifiers are never omitted or reshaped -- passed straight through from
        // each CitationRef exactly as buildCitation() produced it.
        claims: outcome.claims.map((claim) => ({
          text: claim.text,
          citations: claim.citations.map((citation) => ({
            citation_id: citation.citation_id,
            fragment_id: citation.fragment_id,
            materialization_id: citation.materialization_id,
            source_provenance_refs: citation.source_provenance_refs,
            rank: citation.rank,
            score: citation.score,
            query_run_identity: citation.query_run_identity,
          })),
        })),
      });
    } catch (error: unknown) {
      const safe = toSafeErrorResponse(error);
      res.status(safe.statusCode ?? 500).json(safe);
    }
  },
);

export default router;
