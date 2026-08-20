/**
 * LEGAL-RETRIEVAL-RAG-ANSWER-COMPOSITION-01.
 *
 * The composed answer chain:
 *
 *   query -> performLegalRetrieval() -> RetrievalResult[]
 *     -> bounded context assembly (LegalAnswerContextV1, mps-legal-answer-contract)
 *     -> answer model (AnswerModelProvider)
 *     -> claims -> citation validation (buildCitation, mps-legal-answer-contract)
 *     -> AnswerTraceArtifact
 *
 * The governing invariant, enforced structurally, not by convention:
 *
 *   AN ANSWER MAY CITE ONLY A GOVERNED RetrievalResult RETURNED BY THE CURRENT RETRIEVAL RUN.
 *
 * This module never lets the answer model's own claimed citations reach a caller unchecked. Every
 * `cited_fragments` entry a model proposes is passed through buildCitation() against the SAME
 * LegalAnswerContextV1 the model was actually given -- a citation to anything else (nonexistent
 * fragment, wrong materialization, or a fragment that was never included in the context in the
 * first place) is dropped, never fabricated into the response. A claim left with zero surviving
 * citations is dropped entirely -- an evidence-bound answer never carries an unsupported claim.
 *
 * `performLegalRetrieval` itself is untouched -- this module composes on top of it, never
 * re-implements or bypasses its governance (law routing, embedding identity, provenance).
 */

import {
  buildAnswerTrace,
  buildCitation,
  buildLegalAnswerContext,
  CitationError,
  DEFAULT_ANSWER_CONTEXT_POLICY,
  evaluateQuerySpecificity,
  type AnswerTraceArtifact,
  type CitationRef,
  type LegalAnswerContextPolicy,
  type LegalAnswerContextV1,
  type LegalAnswerMode,
  type QuerySpecificityResult,
  type RetrievalResultWithContent,
} from "@miljobeslut/mps-legal-answer-contract";
import { prisma } from "../../../db/prisma";
import {
  hashQuery,
  performLegalRetrieval,
  type LegalFamily,
  type LegalRetrievalDeps,
  type LegalRetrievalOutcome,
} from "../retrieval/LegalRetrievalComposition";
import { createGeminiAnswerModelProvider, type AnswerModelProvider } from "./GeminiAnswerModelProvider";

export const LEGAL_ANSWER_COMPOSITION_VERSION = "legal-answer-composition-v1";

export interface LegalAnswerRequest {
  readonly query: string;
  readonly family?: LegalFamily;
  readonly topK?: number;
  readonly sourceConstraintOverride?: readonly string[];
  readonly contextPolicy?: LegalAnswerContextPolicy;
}

export interface ChunkContentLookup {
  (fragmentId: string, materializationId: string): Promise<string | null>;
}

export interface LegalAnswerDeps {
  readonly retrievalDeps: LegalRetrievalDeps;
  readonly answerModel: AnswerModelProvider;
  readonly fetchChunkContent: ChunkContentLookup;
}

export interface AdmittedClaim {
  readonly text: string;
  readonly citations: readonly CitationRef[];
}

export interface LegalAnswerOutcome {
  readonly mode: LegalAnswerMode;
  readonly claims: readonly AdmittedClaim[];
  readonly answerTrace: AnswerTraceArtifact;
  /** null only for mode=QUERY_UNDERSPECIFIED -- the gate runs BEFORE retrieval, so no retrieval
   *  ever happened for that query. Every other mode always carries a real retrieval outcome. */
  readonly retrieval: LegalRetrievalOutcome | null;
  readonly context: LegalAnswerContextV1 | null;
  readonly querySpecificity: QuerySpecificityResult;
}

function insufficientEvidence(
  retrieval: LegalRetrievalOutcome,
  answerModel: AnswerModelProvider,
  context: LegalAnswerContextV1 | null,
  querySpecificity: QuerySpecificityResult,
): LegalAnswerOutcome {
  const answerTrace = buildAnswerTrace({
    query_run_identity: retrieval.trace.identity.query_hash,
    context_policy_version: context?.context_policy_version ?? "none",
    mode: "INSUFFICIENT_EVIDENCE",
    cited_fragment_ids: [],
    answer_model_id: answerModel.model_id,
    answer_model_version: answerModel.model_version,
    answer_pipeline_version: answerModel.pipeline_version,
  });
  return { mode: "INSUFFICIENT_EVIDENCE", claims: [], answerTrace, retrieval, context, querySpecificity };
}

/**
 * The real, composed answer call. Every governed boundary fails closed:
 *   - a query with no content-bearing terms at all -> QUERY_UNDERSPECIFIED, before retrieval even
 *     runs (LEGAL-ANSWER-QUERY-SPECIFICITY-GATE-01) -- distinct from INSUFFICIENT_EVIDENCE, which
 *     is decided AFTER real retrieval based on what evidence was actually found
 *   - zero retrieval results -> INSUFFICIENT_EVIDENCE, no model call at all
 *   - a result whose real text cannot be resolved -> excluded before context assembly
 *   - the model itself reporting insufficient_evidence -> INSUFFICIENT_EVIDENCE, claims discarded
 *   - a citation outside the context, or under the wrong materialization -> dropped
 *   - a claim left with zero surviving citations -> dropped entirely
 */
export async function composeLegalAnswer(
  request: LegalAnswerRequest,
  deps: LegalAnswerDeps,
): Promise<LegalAnswerOutcome> {
  // The gate never inspects retrieval results, context, or the answer model -- it is a pure,
  // deterministic check on the query string alone, and runs first so an underspecified query never
  // spends an embedding call or a DB round trip.
  const querySpecificity = evaluateQuerySpecificity(request.query);
  if (querySpecificity.verdict === "UNDERSPECIFIED") {
    const answerTrace = buildAnswerTrace({
      query_run_identity: hashQuery(request.query),
      context_policy_version: "none",
      mode: "QUERY_UNDERSPECIFIED",
      cited_fragment_ids: [],
      answer_model_id: deps.answerModel.model_id,
      answer_model_version: deps.answerModel.model_version,
      answer_pipeline_version: deps.answerModel.pipeline_version,
    });
    return { mode: "QUERY_UNDERSPECIFIED", claims: [], answerTrace, retrieval: null, context: null, querySpecificity };
  }

  const retrieval = await performLegalRetrieval(
    {
      query: request.query,
      family: request.family,
      topK: request.topK,
      sourceConstraintOverride: request.sourceConstraintOverride,
    },
    deps.retrievalDeps,
  );

  if (retrieval.results.length === 0) {
    return insufficientEvidence(retrieval, deps.answerModel, null, querySpecificity);
  }

  const withContent: RetrievalResultWithContent[] = [];
  for (const result of retrieval.results) {
    const content = await deps.fetchChunkContent(result.fragment_id, result.materialization_id);
    if (content === null) continue; // fail closed: never build context from missing text
    withContent.push({ result, content });
  }

  if (withContent.length === 0) {
    return insufficientEvidence(retrieval, deps.answerModel, null, querySpecificity);
  }

  const context = buildLegalAnswerContext(withContent, request.contextPolicy ?? DEFAULT_ANSWER_CONTEXT_POLICY);

  if (context.selected.length === 0) {
    return insufficientEvidence(retrieval, deps.answerModel, context, querySpecificity);
  }

  const generation = await deps.answerModel.generateAnswer(
    request.query,
    context.selected.map((s) => ({
      fragment_id: s.fragment_id,
      materialization_id: s.materialization_id,
      content: s.content,
    })),
  );

  if (generation.insufficient_evidence) {
    return insufficientEvidence(retrieval, deps.answerModel, context, querySpecificity);
  }

  const admittedClaims: AdmittedClaim[] = [];
  const citedFragmentIds = new Set<string>();
  for (const claim of generation.claims) {
    const citations: CitationRef[] = [];
    for (const claimed of claim.cited_fragments) {
      try {
        const citation = buildCitation(claimed, context);
        citations.push(citation);
        citedFragmentIds.add(citation.fragment_id);
      } catch (error) {
        if (error instanceof CitationError) continue; // fail closed: drop, never fabricate
        throw error;
      }
    }
    if (citations.length === 0) continue; // unsupported claim -- never returned
    admittedClaims.push({ text: claim.text, citations });
  }

  const mode: LegalAnswerMode = admittedClaims.length === 0 ? "INSUFFICIENT_EVIDENCE" : "ANSWERED";

  const answerTrace = buildAnswerTrace({
    query_run_identity: context.query_run_identity,
    context_policy_version: context.context_policy_version,
    mode,
    cited_fragment_ids: [...citedFragmentIds],
    answer_model_id: deps.answerModel.model_id,
    answer_model_version: deps.answerModel.model_version,
    answer_pipeline_version: deps.answerModel.pipeline_version,
  });

  return { mode, claims: admittedClaims, answerTrace, retrieval, context, querySpecificity };
}

/** Real, Prisma/Gemini-backed default dependencies. */
export function createLegalAnswerComposition(retrievalDeps: LegalRetrievalDeps): LegalAnswerDeps {
  const fetchChunkContent: ChunkContentLookup = async (fragmentId, materializationId) => {
    const row = await prisma.legalCorpusMaterializedChunk.findUnique({
      where: { materializationId_fragmentId: { materializationId, fragmentId } },
    });
    return row?.chunkText ?? null;
  };

  return {
    retrievalDeps,
    answerModel: createGeminiAnswerModelProvider(),
    fetchChunkContent,
  };
}
