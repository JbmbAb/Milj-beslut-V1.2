/**
 * LEGAL-RETRIEVAL-PRODUCTION-COMPOSITION-01.
 *
 * The real, composed serving chain -- every prior unit in this track was script-only proof; this
 * is the first actual callable function wiring the frozen pieces together:
 *
 *   query -> family routing -> LegalRetrievalPolicy -> law metadata router (family=law only)
 *     -> governed embedding search -> exact fragment/materialization resolution
 *     -> RetrievalExecutionTrace -> RetrievalResult -> provenance
 *
 * No new retrieval strategy is invented here. `law` uses the FROZEN production strategy
 * (LEGAL-RETRIEVAL-LAW-MULTI-SOURCE-ROUTING-01: multi-source candidate constraints + per-source
 * chapter binding). `court`/`standard` stay on the plain vector-only path -- explicitly not
 * decided to need anything else yet, per instruction.
 *
 * "Family routing" here is an EXPLICIT caller-supplied hint (`request.family`), not a text
 * classifier -- no unit in this track has proven a query->family classifier, and inventing one
 * now would be exactly the kind of fabrication this whole track has consistently refused to do.
 * A caller with no family signal passes `family: undefined` and searches across all families
 * unconstrained, same as every prior baseline/pilot run's default behavior.
 *
 * Dependency-injected (embedding provider, chunk search, chunk lookup) so the orchestration logic
 * itself is unit-testable with fakes -- real defaults are Prisma/Gemini-backed, wired in
 * `createLegalRetrievalComposition()`.
 */
import { createHash } from "node:crypto";
import { bindEmbeddingIdentity, type EmbeddingIdentityFields } from "@miljobeslut/mps-embedding-identity";
import {
  buildRetrievalResult,
  createInMemoryGovernedChunkLookup,
  type GovernedChunkRef,
  type RetrievalResultFields,
} from "@miljobeslut/mps-legal-retrieval-contract";
import { evaluateLegalRetrieval } from "@miljobeslut/mps-retrieval-governance";
import { createRetrievalExecutionTrace, type RetrievalExecutionTraceArtifact } from "@miljobeslut/mps-retrieval-trace";
import { prisma } from "../../../db/prisma";
import {
  createGeminiEmbeddingProvider,
  type EmbeddingProvider,
} from "./GeminiEmbeddingProvider";
import { buildCandidateWhereClause } from "./LawSourceRoutingSql";
import { describeRoutingDecision, routeLawQuery, type RoutingDecision } from "./LawSourceRouter";

export type LegalFamily = "law" | "court" | "standard";

export interface LegalRetrievalRequest {
  readonly query: string;
  /** Explicit hint, not an inferred classification. Omit to search all families unconstrained. */
  readonly family?: LegalFamily;
  readonly topK?: number;
  /**
   * A privileged caller's own explicit source constraint (logical_source_id list), used INSTEAD
   * of the automatic law metadata router's decision -- never merged, never a suggestion on top of
   * it. Caller authority is enforced by the serving boundary before this reaches here (this
   * function does not itself check permissions); only valid for family="law", since no other
   * family has an equivalent constraint mechanism to override. Providing it for a different
   * family throws rather than being silently ignored.
   */
  readonly sourceConstraintOverride?: readonly string[];
}

export class LegalRetrievalRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LegalRetrievalRequestError";
  }
}

export interface SearchHit {
  readonly fragment_id: string;
  readonly materialization_id: string;
  readonly chunk_content_hash: string;
  readonly structure_kind: LegalFamily;
  readonly distance: number;
}

export interface ChunkRefLookup {
  (fragmentId: string, materializationId: string): Promise<GovernedChunkRef | null>;
}

export interface SearchChunks {
  (
    queryVector: readonly number[],
    modelId: string,
    pipelineVersion: string,
    family: LegalFamily | undefined,
    routing: RoutingDecision | null,
    topK: number,
  ): Promise<SearchHit[]>;
}

export interface LegalRetrievalDeps {
  readonly embeddingProvider: EmbeddingProvider;
  readonly searchChunks: SearchChunks;
  readonly lookupChunkRef: ChunkRefLookup;
}

export interface LegalRetrievalOutcome {
  readonly results: readonly RetrievalResultFields[];
  readonly trace: RetrievalExecutionTraceArtifact;
  readonly routing: RoutingDecision | null;
}

const DEFAULT_TOP_K = 10;
/** Bumped whenever this composed chain's own behavior changes -- distinct from the router's own
 *  LAW_SOURCE_ROUTING_VERSION, which versions the routing decision itself.
 *  v2 (LEGAL-ANSWER-MULTISOURCE-RETRIEVAL-BUDGET-01): createLegalRetrievalComposition()'s real
 *  searchChunks runs one query per candidate source, each at the unchanged per-source topK, when
 *  routing recognizes 2+ candidates -- 0/1-candidate queries are byte-for-byte unchanged. Retrieval
 *  POLICY (LEGAL_RETRIEVAL_POLICY_VERSION) and the trace's own shape are untouched; only this
 *  composed chain's search strategy for the multi-source case changed. */
export const LEGAL_RETRIEVAL_COMPOSITION_VERSION = "legal-retrieval-composition-v2";

export function hashQuery(query: string): string {
  return createHash("sha256").update(query, "utf8").digest("hex");
}

/**
 * The real, composed retrieval call. Fails closed at every governed boundary: a hit whose
 * embedding identity does not match its claimed governed chunk is dropped, never silently kept
 * (buildRetrievalResult throws; caught here and excluded rather than propagated as a fatal error,
 * since one bad hit should not fail an entire multi-result query -- but it is never returned).
 */
export async function performLegalRetrieval(
  request: LegalRetrievalRequest,
  deps: LegalRetrievalDeps,
): Promise<LegalRetrievalOutcome> {
  const topK = request.topK ?? DEFAULT_TOP_K;

  // LegalRetrievalPolicy gate -- read-only, never creates authority. Same policy check every
  // prior unit in this track has performed before running a search.
  const decision = evaluateLegalRetrieval("LEGAL_CORPUS_SEARCH");

  if (request.sourceConstraintOverride && request.family !== "law") {
    throw new LegalRetrievalRequestError(
      "SOURCE_OVERRIDE_REQUIRES_LAW_FAMILY",
      `sourceConstraintOverride was provided for family=${request.family ?? "unspecified"}, but only "law" has a constraint mechanism to override`,
    );
  }

  // Law metadata router only engages when family=law -- the frozen production strategy for law,
  // untouched here. court/standard get routing: null (plain vector-only path). A caller-supplied
  // sourceConstraintOverride REPLACES the automatic router decision entirely (never merged) --
  // caller authority to set it is enforced by the serving boundary, not here.
  let routing: RoutingDecision | null = null;
  if (request.family === "law") {
    routing = request.sourceConstraintOverride
      ? {
          routing_version: LEGAL_RETRIEVAL_COMPOSITION_VERSION,
          source_candidates: request.sourceConstraintOverride.map((logicalSourceId) => ({
            logicalSourceId,
            chapter_constraint: null,
            matched_signal: "caller_override",
          })),
        }
      : routeLawQuery(request.query);
  }
  const routingLabel = routing ? describeRoutingDecision(routing) : `${LEGAL_RETRIEVAL_COMPOSITION_VERSION}:family=${request.family ?? "unspecified"}`;

  const [queryVector] = await deps.embeddingProvider.embedBatch([request.query]);
  const hits = await deps.searchChunks(
    queryVector!,
    deps.embeddingProvider.model_id,
    deps.embeddingProvider.pipeline_version,
    request.family,
    routing,
    topK,
  );

  const results: RetrievalResultFields[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const ref = await deps.lookupChunkRef(hit.fragment_id, hit.materialization_id);
    if (!ref) continue; // fail closed: unresolvable hit is dropped, never fabricated

    const identity: EmbeddingIdentityFields = bindEmbeddingIdentity({
      fragment_id: hit.fragment_id,
      materialization_id: hit.materialization_id,
      chunk_content_hash: hit.chunk_content_hash,
      embedding_model_id: deps.embeddingProvider.model_id,
      embedding_model_version: deps.embeddingProvider.model_version,
      embedding_pipeline_version: deps.embeddingProvider.pipeline_version,
    });

    const lookup = createInMemoryGovernedChunkLookup([ref]);
    try {
      const result = buildRetrievalResult(
        {
          fragment_id: hit.fragment_id,
          materialization_id: hit.materialization_id,
          source_provenance_refs: [`materialization:${hit.materialization_id}`],
          embedding_identity: identity,
          retrieval_policy_version: decision.policy.policy_version,
          query_run_identity: hashQuery(request.query),
          score: 1 - hit.distance,
          rank: i + 1,
        },
        lookup,
      );
      results.push(result);
    } catch {
      // buildRetrievalResult failed closed (e.g. embedding identity mismatch) -- excluded, not
      // fabricated as a result.
      continue;
    }
  }

  const trace = createRetrievalExecutionTrace({
    query_hash: hashQuery(request.query),
    policy_version: decision.policy.policy_version,
    artifact_snapshot: LEGAL_RETRIEVAL_COMPOSITION_VERSION,
    selected_artifact_refs: results.map((r) => r.fragment_id),
    budget_profile: "default",
    expansion_path: [routingLabel],
  });

  return { results, trace, routing };
}

/** Real, Prisma/Gemini-backed default dependencies. */
export function createLegalRetrievalComposition(): LegalRetrievalDeps {
  const embeddingProvider = createGeminiEmbeddingProvider();

  const runSearch = async (
    queryVector: readonly number[],
    modelId: string,
    pipelineVersion: string,
    family: LegalFamily | undefined,
    routingForQuery: RoutingDecision | null,
    limit: number,
  ): Promise<SearchHit[]> => {
    const vectorLiteral = `[${queryVector.join(",")}]`;
    const baseParams: unknown[] = [vectorLiteral, modelId, pipelineVersion];
    let familyFilter = "";
    if (family) {
      baseParams.push(family);
      familyFilter = `AND c.structure_kind = $${baseParams.length}`;
    }
    const where = routingForQuery ? buildCandidateWhereClause(routingForQuery, baseParams.length) : { sql: "", params: [] };
    const params = [...baseParams, ...where.params, limit];
    const limitParam = `$${params.length}`;

    return prisma.$queryRawUnsafe<SearchHit[]>(
      `SELECT e.fragment_id, e.materialization_id, e.chunk_content_hash, c.structure_kind,
              (e.embedding_vector <=> $1::vector) AS distance
       FROM "legal_corpus_chunk_embeddings" e
       JOIN "legal_corpus_materialized_chunks" c
         ON c.materialization_id = e.materialization_id AND c.fragment_id = e.fragment_id
       JOIN "legal_corpus_materializations" m ON m.id = c.materialization_id
       WHERE e.embedding_model_id = $2 AND e.embedding_pipeline_version = $3
         ${familyFilter} ${where.sql}
       ORDER BY e.embedding_vector <=> $1::vector
       LIMIT ${limitParam}`,
      ...params,
    );
  };

  const searchChunks: SearchChunks = async (queryVector, modelId, pipelineVersion, family, routing, topK) => {
    // LEGAL-ANSWER-MULTISOURCE-RETRIEVAL-BUDGET-01: strictly local to the multi-source case. 0 or
    // 1 recognized candidates run the exact prior single-query path, byte-for-byte, at the exact
    // prior budget (topK unchanged). 2+ recognized candidates -- a query the router has already
    // decided must search ALL of them -- run one query PER candidate, each still at the ORIGINAL
    // per-source budget (topK unchanged per source, never a blanket topK increase for all
    // queries), then merge and re-rank by the same single distance metric already used everywhere
    // else in this chain. No reranker, no BM25, no new relevance signal: same metric, applied once
    // per source instead of once globally, so a source that would otherwise be crowded out of a
    // single combined top-K by a more prolific source still gets its own fair top-K search.
    if (routing && routing.source_candidates.length >= 2) {
      const perSourceHits = await Promise.all(
        routing.source_candidates.map((candidate) =>
          runSearch(queryVector, modelId, pipelineVersion, family, { routing_version: routing.routing_version, source_candidates: [candidate] }, topK),
        ),
      );
      return perSourceHits.flat().sort((a, b) => a.distance - b.distance);
    }

    return runSearch(queryVector, modelId, pipelineVersion, family, routing, topK);
  };

  const lookupChunkRef: ChunkRefLookup = async (fragmentId, materializationId) => {
    const row = await prisma.legalCorpusMaterializedChunk.findUnique({
      where: { materializationId_fragmentId: { materializationId, fragmentId } },
    });
    if (!row) return null;
    return {
      fragment_id: row.fragmentId,
      materialization_id: row.materializationId,
      content_hash: row.contentHash,
      structure_kind: row.structureKind as LegalFamily,
    };
  };

  return { embeddingProvider, searchChunks, lookupChunkRef };
}
