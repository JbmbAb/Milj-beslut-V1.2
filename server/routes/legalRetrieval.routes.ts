/**
 * LEGAL-RETRIEVAL-SERVING-BOUNDARY-01.
 *
 * The HTTP boundary over the governed retrieval chain (performLegalRetrieval). Deliberately thin:
 * validate input, authorize, call the composed function, serialize a versioned DTO. No retrieval
 * logic lives here -- routing, embedding, resolution, and provenance enforcement all happen
 * inside performLegalRetrieval(), which this route never duplicates or bypasses.
 *
 * Explicitly NOT here: freeform LLM answer generation, citation synthesis, query rewriting, a
 * reranker, hybrid BM25, or a hidden family classifier. `family` remains an explicit caller hint
 * (see LegalRetrievalComposition.ts) -- omitted means broad unconstrained retrieval across all
 * families, never a guess.
 *
 * NOT the legacy `/api/legal/search` route (searchLegalCorpusTool, the OLD legal_corpus_chunks
 * table -- see LEGAL-RETRIEVAL-ARCH-RECON-01). This is a new, separate path over the governed
 * corpus; the legacy route is untouched.
 */
import express, { type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../security/auth';
import { rateLimitByUser } from '../security/rateLimit';
import { toSafeErrorResponse } from '../security/secureErrors';
import {
  createLegalRetrievalComposition,
  performLegalRetrieval,
  LegalRetrievalRequestError,
  type LegalFamily,
} from '../modules/legal/retrieval/LegalRetrievalComposition';

const router = express.Router();

export const LEGAL_RETRIEVAL_SERVING_CONTRACT_VERSION = 'legal-retrieval-serving-v1';

const RequestSchema = z.object({
  query: z.string().min(2).max(500),
  family: z.enum(['law', 'court', 'standard']).optional(),
  top_k: z.number().int().min(1).max(50).optional(),
  allowed_source_constraints: z.array(z.string().min(1)).min(1).max(20).optional(),
});

// POST /api/legal/retrieval/search — governed retrieval only, no answer generation.
router.post(
  '/api/legal/retrieval/search',
  requireAuth,
  rateLimitByUser(30, 60_000),
  async (req: Request, res: Response) => {
    try {
      const parsed = RequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ ok: false, error: 'Invalid request', details: parsed.error.flatten() });
        return;
      }
      const { query, family, top_k, allowed_source_constraints } = parsed.data;

      // Caller authority to override source constraints: ADMIN role only, by deliberate
      // conservative default -- a dedicated permission was NOT added to the shared
      // rolePermissions map (projectAccess.ts) for this unit, since that is a shared,
      // security-sensitive surface other routes also depend on and a broader permission model
      // is out of this narrow unit's scope. Non-ADMIN callers supplying this field are rejected,
      // not silently downgraded to an unconstrained search.
      if (allowed_source_constraints && req.authUser!.role !== 'ADMIN') {
        res.status(403).json({ ok: false, error: 'allowed_source_constraints requires ADMIN role' });
        return;
      }

      const deps = createLegalRetrievalComposition();
      const outcome = await performLegalRetrieval(
        {
          query,
          family: family as LegalFamily | undefined,
          topK: top_k,
          sourceConstraintOverride: allowed_source_constraints,
        },
        deps,
      );

      // Provenance identifiers are never omitted from the response -- fragment_id,
      // materialization_id, and source_provenance_refs are serialized directly from
      // RetrievalResultFields, not re-derived or reshaped here.
      res.json({
        ok: true,
        contract_version: LEGAL_RETRIEVAL_SERVING_CONTRACT_VERSION,
        query_run_identity: outcome.trace.identity.query_hash,
        trace: {
          trace_hash: outcome.trace.trace_hash,
          contract_version: outcome.trace.contract_version,
          policy_version: outcome.trace.identity.policy_version,
          query_hash: outcome.trace.identity.query_hash,
          artifact_snapshot: outcome.trace.identity.artifact_snapshot,
          expansion_path: outcome.trace.identity.expansion_path,
        },
        results: outcome.results.map((r) => ({
          fragment_id: r.fragment_id,
          materialization_id: r.materialization_id,
          source_provenance_refs: r.source_provenance_refs,
          score: r.score,
          rank: r.rank,
        })),
      });
    } catch (error: unknown) {
      if (error instanceof LegalRetrievalRequestError) {
        res.status(400).json({ ok: false, error: error.message, code: error.code });
        return;
      }
      const safe = toSafeErrorResponse(error);
      res.status(safe.statusCode ?? 500).json(safe);
    }
  },
);

export default router;
