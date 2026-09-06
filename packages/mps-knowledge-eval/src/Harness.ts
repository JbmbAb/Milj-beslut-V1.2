import { createHash } from 'node:crypto';

import { canonicalizeStrict } from '@miljobeslut/mimers-brunn-core';
import {
  codepointCompare,
  isAdmittedProjection,
  KNOWLEDGE_CORPUS_PROJECTION_VERSION,
  type CorpusSnapshot,
} from '@miljobeslut/mps-knowledge-corpus';
import {
  createGovernedKnowledgeLookup,
  expectedIndexRow,
  matchesFilters,
  rowDifferences,
  searchKnowledgeIndex,
  stripVector,
  tokenizeForFixtureEmbedding,
  validateFilters,
  verifyIndexProjectionWithReembedding,
  type EmbeddingProviderBinding,
  type GovernedKnowledgeLookup,
  type IndexRow,
  type KnowledgeEmbeddingProvider,
  type KnowledgeIndexProjection,
  type KnowledgeRetrievalHit,
  type RetrievalFilters,
} from '@miljobeslut/mps-knowledge-index';

import {
  goldSetHash,
  validateGoldenCases,
  type ChunkPredicate,
  type GoldenCase,
  type GoldenCategory,
} from './GoldenCase';
import { hitAtK, mean, ndcgAtK, recallAtK, reciprocalRank, round4 } from './Metrics';
import { KNOWLEDGE_EVAL_REPORT_SCHEMA, KNOWLEDGE_EVAL_VERSION } from './versions';

/**
 * Three retrieval strategies over the SAME corpus, index, provider and gold, so the only variable is
 * the strategy:
 *   `unrestricted`    pure nearest-neighbour over the whole index, ignoring case filters (the shape
 *                     of today's court/standard serving path) — the BASELINE;
 *   `source_narrowed` only the case's source_ids / roles filters (what a user can state without
 *                     knowing the answer's structure) — measures ranking quality INSIDE a source;
 *   `narrowed`        every filter the case declares (source, role, version, chapter, section,
 *                     anchor) — the CANDIDATE, i.e. metadata narrowing then semantic ranking.
 * The report says, per case, how many relevant rows exist in the index and how many survive the
 * mode's narrowing, and whether narrowing alone guarantees the pass (`structurally_guaranteed`),
 * so the candidate-over-baseline delta is never read as ranking gain.
 *
 * WHAT THE HARD METRICS MEASURE. provenance_correctness, canonical_identity_resolution and
 * unauthorized_source_acceptance are re-derived here from the governed corpus for every hit; the
 * search layer already refuses to serve a row that disagrees with the governed corpus, so in a run
 * that completes they are expected to be 1 / 1 / 0 — they are the eval's independent confirmation
 * of that refusal, not a separate observation of the ranking. The metrics that can vary with the
 * retrieval strategy are the hit/recall/MRR/nDCG family, version_correctness, unsupported_claim_rate,
 * stale_or_wrong_version_acceptance and exclusion_violations.
 */
export type EvalMode = 'unrestricted' | 'source_narrowed' | 'narrowed';

export interface EvalConfig {
  readonly mode: EvalMode;
  readonly top_k: number;
  readonly ks: readonly number[];
  readonly abstain_below_score: number;
  readonly default_required_hit_within: number;
  /** How `abstain_below_score` was obtained, when it was calibrated from a null model (recorded, reviewable; acceptance requires it to match). */
  readonly abstention_calibration?: {
    readonly calibration_queries: readonly string[];
    readonly null_scores: readonly number[];
    readonly max_null_score: number;
    readonly margin: number;
    readonly threshold: number;
  };
}

export const DEFAULT_EVAL_CONFIG: EvalConfig = Object.freeze({
  mode: 'narrowed',
  top_k: 10,
  ks: Object.freeze([1, 3, 5, 10]),
  abstain_below_score: 0,
  default_required_hit_within: 5,
});

export interface EvalHit {
  readonly rank: number;
  readonly fragment_id: string;
  readonly document_id: string;
  readonly source_id: string;
  readonly score: number;
  readonly relevant: boolean;
  readonly anchor: string;
}

export interface CaseResult {
  readonly case_id: string;
  readonly category: GoldenCategory;
  readonly outcome: 'PASS' | 'FAIL';
  readonly failure_reasons: readonly string[];
  readonly kind: 'RESULTS' | 'NO_EVIDENCE';
  readonly candidate_count: number;
  /** Relevant rows anywhere in the index (the gold expectation resolved against the read model). */
  readonly relevant_in_index: number;
  /** Relevant rows that survive this mode's narrowing — what ranking can actually find. */
  readonly relevant_in_pool: number;
  /** True when the narrowed pool has fewer irrelevant rows than the required rank: narrowing alone decides the case, ranking cannot fail it. */
  readonly structurally_guaranteed: boolean;
  readonly hit_at: Readonly<Record<string, number>>;
  readonly recall_at: Readonly<Record<string, number>>;
  readonly reciprocal_rank: number;
  readonly ndcg_at_10: number;
  readonly provenance_ok: boolean;
  readonly provenance_failures: readonly string[];
  readonly exclusions_ok: boolean;
  readonly version_ok: boolean;
  readonly abstention_ok: boolean | null;
  readonly trace_hash: string;
  readonly hits: readonly EvalHit[];
}

export interface DocumentTextCoverage {
  readonly document_id: string;
  readonly canonical_record_key: string;
  /** chunk chars / projected chars, UNCAPPED (> 1 means chunks repeat projection text). */
  readonly coverage: number;
}

export interface CoverageMetrics {
  readonly documents_total: number;
  readonly documents_admitted: number;
  readonly documents_extraction_failed: number;
  readonly documents_empty: number;
  readonly documents_not_admitted: number;
  readonly chunks_total: number;
  /** Admitted chunks with fewer than 4 content tokens (e.g. cross-reference splinters such as "5 §§ och") — a chunker observation reported, not hidden. */
  readonly degenerate_chunks: number;
  readonly index_rows: number;
  readonly index_skipped_documents: number;
  readonly metadata_complete_rows: number;
  /** admitted / total */
  readonly admission_rate: number;
  /** rows carrying role + method + source + projection + registry hash + currency / rows */
  readonly metadata_completeness: number;
  /** Per admitted document: chars carried by its admitted chunks / projected chars. Text a chunker silently drops shows up here as < 1. */
  readonly text_coverage_min: number;
  readonly text_coverage_mean: number;
  readonly documents_text_coverage_below_0_9: number;
  /** Every admitted document whose coverage is below 0.9 or above 1.05, named. */
  readonly documents_text_coverage_outliers: readonly DocumentTextCoverage[];
}

export interface EvalMetrics {
  readonly cases_total: number;
  readonly cases_passed: number;
  readonly retrieval_cases: number;
  /** Retrieval cases that returned NO_EVIDENCE under this mode (a retrieval question the system did not attempt to answer). */
  readonly retrieval_cases_no_evidence: number;
  /** Retrieval cases whose pass cannot depend on ranking under this mode's narrowing. */
  readonly structurally_guaranteed_cases: number;
  readonly hit_at: Readonly<Record<string, number>>;
  readonly recall_at: Readonly<Record<string, number>>;
  readonly mrr: number;
  readonly ndcg_at_10: number;
  /** evaluated hits with intact chunk -> document -> registry provenance / evaluated hits */
  readonly provenance_correctness: number;
  readonly evaluated_hits: number;
  readonly canonical_identity_resolution: number;
  readonly version_correctness: number;
  readonly version_cases: number;
  readonly unsupported_claim_rate: number;
  readonly abstention_cases: number;
  readonly adversarial_pass_rate: number;
  readonly adversarial_cases: number;
  readonly unauthorized_source_acceptance: number;
  readonly stale_or_wrong_version_acceptance: number;
  readonly exclusion_violations: number;
}

export interface EvalReport {
  readonly report_schema: typeof KNOWLEDGE_EVAL_REPORT_SCHEMA;
  readonly eval_version: typeof KNOWLEDGE_EVAL_VERSION;
  readonly corpus_projection_version: typeof KNOWLEDGE_CORPUS_PROJECTION_VERSION;
  readonly corpus_snapshot_identity: string;
  readonly catalog_origin: string;
  readonly index_snapshot_identity: string;
  /** The index passed `verifyIndexProjection` against the (verified) corpus, INCLUDING re-embedding of every row, with zero violations before any case ran (otherwise the eval is REJECTED, not run). */
  readonly index_verified: 'verified_with_reembedding';
  readonly embedding_model: EmbeddingProviderBinding;
  readonly gold_set_hash: string;
  readonly config: EvalConfig;
  readonly coverage: CoverageMetrics;
  readonly cases: readonly CaseResult[];
  readonly metrics: EvalMetrics;
  /** sha256 over everything above: two runs that agree on this hash produced byte-identical evaluations of the same corpus/index state. */
  readonly report_hash: string;
}

function anchorOf(row: IndexRow): string {
  const m = row.metadata;
  if (m.chapter !== undefined) return `${m.chapter} kap. ${m.paragraph ?? '?'} §`;
  if (m.court_section !== undefined) return m.court_section;
  if (m.evidence_anchor !== undefined) return m.evidence_anchor;
  return `seq:${m.sequence}`;
}

function predicateMatches(row: IndexRow, p: ChunkPredicate): boolean {
  switch (p.kind) {
    case 'law':
      return (
        row.metadata.chapter === p.chapter &&
        (p.paragraph === undefined || row.metadata.paragraph === p.paragraph)
      );
    case 'court_section':
      return row.metadata.court_section === p.section;
    case 'evidence_anchor':
      return (
        row.metadata.evidence_anchor === p.anchor ||
        (row.metadata.evidence_anchor ?? '').startsWith(`${p.anchor}_DEL_`)
      );
    case 'text_contains':
      return row.chunk_text.toLowerCase().includes(p.text.toLowerCase());
    default: {
      const _exhaustive: never = p;
      return _exhaustive;
    }
  }
}

function isRelevant(row: IndexRow, c: GoldenCase, keys: Readonly<Record<string, string>>): boolean {
  if (!c.expected) return false;
  const acceptableDocs = new Set(c.expected.document_keys.map((k) => keys[k]));
  if (!acceptableDocs.has(row.document_id)) return false;
  if (!c.expected.chunk_predicates || c.expected.chunk_predicates.length === 0) return true;
  return c.expected.chunk_predicates.some((p) => predicateMatches(row, p));
}

/** The filters a mode applies. `source_narrowed` keeps only what a user can state without knowing the answer's structure. */
export function filtersForMode(
  mode: EvalMode,
  declared: RetrievalFilters | undefined,
): RetrievalFilters | undefined {
  if (mode === 'unrestricted' || !declared) return undefined;
  if (mode === 'narrowed') return declared;
  const kept: { source_ids?: readonly string[]; roles?: RetrievalFilters['roles'] } = {};
  if (declared.source_ids) kept.source_ids = declared.source_ids;
  if (declared.roles) kept.roles = declared.roles;
  return Object.keys(kept).length ? kept : undefined;
}

/**
 * PROVENANCE CORRECTNESS is checked against the GOVERNED corpus, not against the index that produced
 * the hit: the row is re-derived from the governed chunk/document (every column, including the
 * embedding identity under the index's binding) and the hit's provenance and refs must equal what
 * the governed document says. A hit whose chain does not close is a failure even when its text is
 * relevant.
 */
function checkProvenance(
  hit: KnowledgeRetrievalHit,
  corpus: CorpusSnapshot,
  governed: GovernedKnowledgeLookup,
  index: KnowledgeIndexProjection,
): readonly string[] {
  const failures: string[] = [];
  if (hit.result.resolved_against_governed_chunk !== true)
    failures.push('result not resolved against a governed chunk');
  const entry = governed.resolve(hit.provenance.canonical_record_key, hit.provenance.fragment_id);
  if (!entry)
    return [
      ...failures,
      `no governed chunk ${hit.provenance.fragment_id} under ${hit.provenance.canonical_record_key}`,
    ];
  const { document } = entry;
  const expected = expectedIndexRow(entry, index.provider);
  const differences = rowDifferences(stripVector(hit.row), expected);
  if (differences.length)
    failures.push(`row disagrees with the governed derivation on ${differences.join(', ')}`);
  if (
    hit.row.embedding_identity.embedding_identity_hash !== expected.embedding_identity.embedding_identity_hash
  )
    failures.push('embedding identity is not the one bound to the governed chunk under the index model');
  if (document.document_id !== hit.provenance.document_id)
    failures.push('document_id does not match the materialization it claims');
  if (
    document.catalog_origin !== corpus.catalog_origin ||
    hit.provenance.catalog_origin !== corpus.catalog_origin
  )
    failures.push('provenance names a different authority catalog');
  if (
    expected.chunk_text !== hit.row.chunk_text ||
    expected.embedding_identity.chunk_content_hash !== hit.provenance.chunk_content_hash
  )
    failures.push('chunk content hash / text drifted from the governed chunk');
  if (document.source.source_id !== hit.provenance.source_id)
    failures.push('source_id does not match the document binding');
  if (document.source.registry_artifact_id !== hit.provenance.registry_artifact_id)
    failures.push('registry_artifact_id does not match the document binding');
  if (document.source.registry_source_content_hash !== hit.provenance.registry_source_content_hash)
    failures.push('registry_source_content_hash does not match the document binding');
  if (document.text_projection.projection_id !== hit.provenance.text_projection_id)
    failures.push('text projection id does not match the document projection');
  if (document.role.role !== hit.provenance.role || document.role.method !== hit.provenance.role_method)
    failures.push('role / role method do not match the document');
  const refs = hit.result.source_provenance_refs;
  for (const expectedRef of [
    `registry:${document.source.registry_artifact_id}`,
    `source:${document.source.source_id}`,
    `document:${document.document_id}`,
    `materialization:${document.canonical_record_key}`,
    `projection:${document.text_projection.projection_id}`,
  ]) {
    if (!refs.includes(expectedRef)) failures.push(`missing provenance ref ${expectedRef}`);
  }
  const chainOk =
    document.provenance_chain.length === 4 &&
    document.provenance_chain[0]!.content_hash === document.source.registry_source_content_hash;
  if (!chainOk) failures.push('document provenance chain does not reach the registry entry');
  return failures;
}

export function computeCoverage(corpus: CorpusSnapshot, index: KnowledgeIndexProjection): CoverageMetrics {
  const docs = corpus.documents;
  const admittedDocs = docs.filter(isAdmittedProjection);
  const metadataComplete = index.rows.filter(
    (r) =>
      r.role &&
      r.role_method &&
      r.source_id &&
      r.registry_artifact_id &&
      r.registry_source_content_hash &&
      r.text_projection_id &&
      r.document_id &&
      r.metadata.currency_method &&
      r.metadata.currency_reason,
  ).length;
  const perDocument = admittedDocs.map((d): DocumentTextCoverage => {
    const chars = d.text_projection.char_count;
    const coverage = chars === 0 ? 1 : d.chunks.reduce((n, c) => n + c.full_text.length, 0) / chars;
    return {
      document_id: d.document_id,
      canonical_record_key: d.canonical_record_key,
      coverage: round4(coverage),
    };
  });
  const values = perDocument.map((x) => x.coverage);
  return Object.freeze({
    documents_total: docs.length,
    documents_admitted: admittedDocs.length,
    documents_extraction_failed: docs.filter((d) => d.status === 'EXTRACTION_FAILED').length,
    documents_empty: docs.filter((d) => d.status === 'EMPTY_TEXT').length,
    documents_not_admitted: docs.filter((d) => d.status === 'NOT_ADMITTED').length,
    chunks_total: docs.reduce((n, d) => n + d.chunks.length, 0),
    degenerate_chunks: docs.reduce(
      (n, d) => n + d.chunks.filter((c) => tokenizeForFixtureEmbedding(c.full_text).length < 4).length,
      0,
    ),
    index_rows: index.rows.length,
    index_skipped_documents: index.skipped_documents.length,
    metadata_complete_rows: metadataComplete,
    admission_rate: docs.length === 0 ? 0 : round4(admittedDocs.length / docs.length),
    metadata_completeness: index.rows.length === 0 ? 0 : round4(metadataComplete / index.rows.length),
    text_coverage_min: values.length ? round4(Math.min(...values)) : 1,
    text_coverage_mean: values.length ? round4(mean(values)) : 1,
    documents_text_coverage_below_0_9: values.filter((x) => x < 0.9).length,
    documents_text_coverage_outliers: Object.freeze(
      perDocument
        .filter((x) => x.coverage < 0.9 || x.coverage > 1.05)
        .sort((a, b) => codepointCompare(a.canonical_record_key, b.canonical_record_key)),
    ),
  });
}

export interface RunGoldenEvalArgs {
  readonly corpus: CorpusSnapshot;
  readonly index: KnowledgeIndexProjection;
  readonly provider: KnowledgeEmbeddingProvider;
  readonly cases: readonly GoldenCase[];
  /** fixture document key -> content-derived document_id */
  readonly keys: Readonly<Record<string, string>>;
  readonly config?: Partial<EvalConfig>;
}

export async function runGoldenEval(args: RunGoldenEvalArgs): Promise<EvalReport> {
  const config: EvalConfig = Object.freeze({
    ...DEFAULT_EVAL_CONFIG,
    ...args.config,
    ks: Object.freeze([...(args.config?.ks ?? DEFAULT_EVAL_CONFIG.ks)]),
  });
  validateGoldenCases(args.cases, new Set(Object.keys(args.keys)));
  if (args.index.corpus_snapshot_identity !== args.corpus.snapshot_identity) {
    throw new Error(
      `REJECT_EVAL: index derives from ${args.index.corpus_snapshot_identity}, corpus is ${args.corpus.snapshot_identity}`,
    );
  }
  // The governed side is verified (createGovernedKnowledgeLookup recomputes every corpus identity)
  // and the read model must be provably derived from it — INCLUDING vector content, by re-embedding
  // every row — before a single case runs. An index that fails is REJECTED, never evaluated.
  let governed: GovernedKnowledgeLookup;
  try {
    governed = createGovernedKnowledgeLookup(args.corpus);
  } catch (err) {
    throw new Error(`REJECT_EVAL: ${err instanceof Error ? err.message : String(err)}`);
  }
  const violations = await verifyIndexProjectionWithReembedding(args.index, args.corpus, {
    reembed: { provider: args.provider },
  });
  if (violations.length > 0) {
    const codes = [...new Set(violations.map((v) => v.code))].sort(codepointCompare);
    throw new Error(
      `REJECT_EVAL: index fails read-model verification against the corpus: ${codes.join(', ')} (${violations.length} violation(s))`,
    );
  }
  const authorizedSourceIds = new Set(args.corpus.documents.map((d) => d.source.source_id));
  const superseded = new Set(
    governed.current_document_ids.size >= 0
      ? args.corpus.documents.map((d) => d.document_id).filter((id) => !governed.current_document_ids.has(id))
      : [],
  );

  const results: CaseResult[] = [];
  let evaluatedHits = 0;
  let provenanceOkHits = 0;
  let resolvedHits = 0;
  let unauthorizedHits = 0;
  let staleHits = 0;
  let exclusionViolations = 0;

  for (const c of [...args.cases].sort((a, b) => codepointCompare(a.id, b.id))) {
    const filters = filtersForMode(config.mode, c.filters);
    const applied = validateFilters(filters);
    const outcome = await searchKnowledgeIndex(
      args.index,
      args.provider,
      {
        query: c.query,
        ...(filters ? { filters } : {}),
        top_k: config.top_k,
        abstain_below_score: config.abstain_below_score,
      },
      governed,
    );

    const relevance = outcome.hits.map((h) => isRelevant(h.row, c, args.keys));
    const relevantInIndex = args.index.rows.filter((row) => isRelevant(row, c, args.keys)).length;
    const relevantInPool = args.index.rows.filter(
      (row) => matchesFilters(row, applied) && isRelevant(row, c, args.keys),
    ).length;
    const within = c.required_hit_within ?? config.default_required_hit_within;
    const structurallyGuaranteed =
      !c.expects_no_evidence &&
      filters !== undefined &&
      relevantInPool > 0 &&
      outcome.candidate_count - relevantInPool < within;
    const failures: string[] = [];

    const provenanceFailures: string[] = [];
    for (const h of outcome.hits) {
      evaluatedHits += 1;
      const f = checkProvenance(h, args.corpus, governed, args.index);
      if (f.length === 0) provenanceOkHits += 1;
      else provenanceFailures.push(`${h.result.fragment_id}: ${f.join('; ')}`);
      if (governed.resolve(h.provenance.canonical_record_key, h.provenance.fragment_id)) resolvedHits += 1;
      if (!authorizedSourceIds.has(h.provenance.source_id)) unauthorizedHits += 1;
    }
    const provenanceOk = provenanceFailures.length === 0;
    if (!provenanceOk) failures.push(`provenance: ${provenanceFailures.length} hit(s) with broken chain`);

    const excludedDocs = new Set((c.exclusions?.document_keys ?? []).map((k) => args.keys[k]));
    const excludedSources = new Set(c.exclusions?.source_ids ?? []);
    const exclusionHits = outcome.hits.filter(
      (h) => excludedDocs.has(h.provenance.document_id) || excludedSources.has(h.provenance.source_id),
    );
    const exclusionsOk = exclusionHits.length === 0;
    if (!exclusionsOk) {
      exclusionViolations += exclusionHits.length;
      failures.push(`exclusions: ${exclusionHits.length} hit(s) from excluded documents/sources`);
    }

    // A case that asks for the CURRENT version must never be answered from a superseded one. A case
    // that explicitly selects a historical version by label is answered from that version by design;
    // its correctness is enforced through its expectation/exclusions, not through this check. The
    // declared filter is used in EVERY mode, so the baseline is charged for every superseded hit it
    // returns to a "current" question. "Superseded" is exactly the governed lookup's currency.
    const versionConstrained = c.filters?.version === 'current';
    const staleInThisCase = versionConstrained
      ? outcome.hits.filter((h) => superseded.has(h.provenance.document_id)).length
      : 0;
    const versionOk = staleInThisCase === 0;
    if (!versionOk) {
      staleHits += staleInThisCase;
      failures.push(`version: ${staleInThisCase} hit(s) from a superseded version`);
    }

    let abstentionOk: boolean | null = null;
    if (c.expects_no_evidence) {
      abstentionOk = outcome.kind === 'NO_EVIDENCE';
      if (!abstentionOk) failures.push(`abstention: expected NO_EVIDENCE, got ${outcome.hits.length} hit(s)`);
    } else if (hitAtK(relevance, within) === 0) {
      failures.push(`relevance: no relevant hit within top ${within}`);
    }

    const hitAt: Record<string, number> = {};
    const recallAt: Record<string, number> = {};
    for (const k of config.ks) {
      hitAt[String(k)] = hitAtK(relevance, k);
      recallAt[String(k)] = round4(recallAtK(relevance, relevantInIndex, k));
    }

    results.push(
      Object.freeze({
        case_id: c.id,
        category: c.category,
        outcome: failures.length === 0 ? 'PASS' : 'FAIL',
        failure_reasons: Object.freeze(failures),
        kind: outcome.kind,
        candidate_count: outcome.candidate_count,
        relevant_in_index: relevantInIndex,
        relevant_in_pool: relevantInPool,
        structurally_guaranteed: structurallyGuaranteed,
        hit_at: Object.freeze(hitAt),
        recall_at: Object.freeze(recallAt),
        reciprocal_rank: round4(reciprocalRank(relevance)),
        ndcg_at_10: round4(ndcgAtK(relevance, relevantInIndex, 10)),
        provenance_ok: provenanceOk,
        provenance_failures: Object.freeze(provenanceFailures),
        exclusions_ok: exclusionsOk,
        version_ok: versionOk,
        abstention_ok: abstentionOk,
        trace_hash: outcome.trace.trace_hash,
        hits: Object.freeze(
          outcome.hits.map((h, i) =>
            Object.freeze({
              rank: i + 1,
              fragment_id: h.result.fragment_id,
              document_id: h.provenance.document_id,
              source_id: h.provenance.source_id,
              score: round4(h.score),
              relevant: relevance[i]!,
              anchor: anchorOf(h.row),
            }),
          ),
        ),
      }),
    );
  }

  const byId = new Map(args.cases.map((c) => [c.id, c]));
  const retrieval = results.filter((r) => !byId.get(r.case_id)?.expects_no_evidence);
  const abstention = results.filter((r) => byId.get(r.case_id)?.expects_no_evidence);
  const versionCases = results.filter((r) => byId.get(r.case_id)?.filters?.version === 'current');
  const adversarial = results.filter((r) => r.category === 'adversarial');
  const hitAt: Record<string, number> = {};
  const recallAt: Record<string, number> = {};
  for (const k of config.ks) {
    hitAt[String(k)] = round4(mean(retrieval.map((r) => r.hit_at[String(k)]!)));
    recallAt[String(k)] = round4(mean(retrieval.map((r) => r.recall_at[String(k)]!)));
  }

  const metrics: EvalMetrics = Object.freeze({
    cases_total: results.length,
    cases_passed: results.filter((r) => r.outcome === 'PASS').length,
    retrieval_cases: retrieval.length,
    retrieval_cases_no_evidence: retrieval.filter((r) => r.kind === 'NO_EVIDENCE').length,
    structurally_guaranteed_cases: retrieval.filter((r) => r.structurally_guaranteed).length,
    hit_at: Object.freeze(hitAt),
    recall_at: Object.freeze(recallAt),
    mrr: round4(mean(retrieval.map((r) => r.reciprocal_rank))),
    ndcg_at_10: round4(mean(retrieval.map((r) => r.ndcg_at_10))),
    provenance_correctness: evaluatedHits === 0 ? 1 : round4(provenanceOkHits / evaluatedHits),
    evaluated_hits: evaluatedHits,
    canonical_identity_resolution: evaluatedHits === 0 ? 1 : round4(resolvedHits / evaluatedHits),
    version_correctness:
      versionCases.length === 0
        ? 1
        : round4(versionCases.filter((r) => r.version_ok).length / versionCases.length),
    version_cases: versionCases.length,
    unsupported_claim_rate:
      abstention.length === 0
        ? 0
        : round4(abstention.filter((r) => r.abstention_ok === false).length / abstention.length),
    abstention_cases: abstention.length,
    adversarial_pass_rate:
      adversarial.length === 0
        ? 1
        : round4(adversarial.filter((r) => r.outcome === 'PASS').length / adversarial.length),
    adversarial_cases: adversarial.length,
    unauthorized_source_acceptance: unauthorizedHits,
    stale_or_wrong_version_acceptance: staleHits,
    exclusion_violations: exclusionViolations,
  });

  const body = {
    report_schema: KNOWLEDGE_EVAL_REPORT_SCHEMA,
    eval_version: KNOWLEDGE_EVAL_VERSION,
    corpus_projection_version: KNOWLEDGE_CORPUS_PROJECTION_VERSION,
    corpus_snapshot_identity: args.corpus.snapshot_identity,
    catalog_origin: args.corpus.catalog_origin,
    index_snapshot_identity: args.index.index_snapshot_identity,
    index_verified: 'verified_with_reembedding' as const,
    embedding_model: args.index.provider,
    gold_set_hash: goldSetHash(args.cases),
    config,
    coverage: computeCoverage(args.corpus, args.index),
    cases: Object.freeze(results),
    metrics,
  } as const;
  const reportHash = createHash('sha256').update(canonicalizeStrict(body), 'utf8').digest('hex');
  return Object.freeze({ ...body, report_hash: reportHash });
}

/**
 * Hard acceptance criteria, fixed BEFORE any candidate numbers were looked at (see K2.2 mandate),
 * plus guards that keep the verdict from being reachable by turning knobs: the verdict is defined
 * only for the canonical evaluation configuration, the applied abstention threshold must be the
 * recorded calibrated one, and a report in which retrieval questions went unanswered (NO_EVIDENCE)
 * or nothing was evaluated is not accepted. No ranking-quality floor is invented here — those
 * numbers are reported, not judged.
 */
export interface AcceptanceVerdict {
  readonly accepted: boolean;
  readonly violations: readonly string[];
}

export function judgeAcceptance(report: EvalReport, baseline?: EvalReport): AcceptanceVerdict {
  const v: string[] = [];
  const cfg = report.config;
  if (
    cfg.top_k !== DEFAULT_EVAL_CONFIG.top_k ||
    cfg.default_required_hit_within !== DEFAULT_EVAL_CONFIG.default_required_hit_within
  )
    v.push(
      `CONFIG_DRIFT: top_k=${cfg.top_k}, default_required_hit_within=${cfg.default_required_hit_within} (verdict is defined for ${DEFAULT_EVAL_CONFIG.top_k}/${DEFAULT_EVAL_CONFIG.default_required_hit_within})`,
    );
  if (!cfg.abstention_calibration)
    v.push('CALIBRATION_MISSING: abstain_below_score was not calibrated from a null model');
  else if (cfg.abstention_calibration.threshold !== cfg.abstain_below_score)
    v.push(
      `CALIBRATION_MISMATCH: applied abstain_below_score ${cfg.abstain_below_score} != calibrated ${cfg.abstention_calibration.threshold}`,
    );
  if (report.metrics.evaluated_hits === 0 || report.metrics.retrieval_cases === 0)
    v.push(
      `NON_VACUOUS: evaluated_hits=${report.metrics.evaluated_hits}, retrieval_cases=${report.metrics.retrieval_cases}`,
    );
  if (report.metrics.retrieval_cases_no_evidence > 0)
    v.push(
      `NON_VACUOUS: ${report.metrics.retrieval_cases_no_evidence} retrieval case(s) returned NO_EVIDENCE`,
    );
  if (report.metrics.provenance_correctness !== 1)
    v.push(`PROVENANCE_CORRECTNESS ${report.metrics.provenance_correctness} < 1`);
  if (report.metrics.canonical_identity_resolution !== 1)
    v.push(`CANONICAL_IDENTITY_RESOLUTION ${report.metrics.canonical_identity_resolution} < 1`);
  if (report.metrics.unauthorized_source_acceptance !== 0)
    v.push(`UNAUTHORIZED_SOURCE_ACCEPTANCE ${report.metrics.unauthorized_source_acceptance} != 0`);
  if (report.metrics.stale_or_wrong_version_acceptance !== 0)
    v.push(`STALE_OR_WRONG_VERSION_ACCEPTANCE ${report.metrics.stale_or_wrong_version_acceptance} != 0`);
  if (report.metrics.unsupported_claim_rate !== 0)
    v.push(`UNSUPPORTED_CLAIM_RATE ${report.metrics.unsupported_claim_rate} != 0`);
  if (report.metrics.exclusion_violations !== 0)
    v.push(`EXCLUSION_VIOLATIONS ${report.metrics.exclusion_violations} != 0`);
  if (baseline) {
    if (report.metrics.provenance_correctness < baseline.metrics.provenance_correctness)
      v.push('CANDIDATE_REGRESSION: provenance_correctness');
    if (report.metrics.version_correctness < baseline.metrics.version_correctness)
      v.push('CANDIDATE_REGRESSION: version_correctness');
  }
  return Object.freeze({ accepted: v.length === 0, violations: Object.freeze(v) });
}
