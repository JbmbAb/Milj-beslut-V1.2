/**
 * Phase 2 evaluator: score SearchParams against fixed legal-corpus fixtures
 * using exported RRF/rerank helpers from searchLegalCorpusTool.
 *
 * Usage:
 *   echo '{"RRF_K":60,...}' | npx tsx scripts/alphaevolve/experiments/legal_search_params/run_eval.ts
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  localLexicalRerank,
  shouldSkipReranker,
} from '../../../../server/modules/ai/orchestrator/tools/searchLegalCorpusTool';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type LegalSearchEvalParams = {
  RRF_K: number;
  RRF_K_EXACT: number;
  FTS_CANDIDATE_LIMIT: number;
  VECTOR_CANDIDATE_LIMIT: number;
  RRF_CANDIDATE_LIMIT: number;
  RERANKER_FINAL_K: number;
  LEGAL_RERANKER_RELATIVE_GAP: number;
  rerankerEnabled?: boolean;
};

type ChunkCandidate = {
  chunkId: string;
  recordId: string;
  chunkText: string;
  similarity?: number;
  rank?: number;
};

type RrfEntry = {
  rrf: number;
  similarity?: number;
  rank?: number;
  candidate?: ChunkCandidate;
};

type EvalCase = {
  id: string;
  query: string;
  must_include_terms: string[];
  min_results: number;
};

type FixtureArms = {
  fts: ChunkCandidate[];
  vector: ChunkCandidate[];
  exact: ChunkCandidate[];
};

function addArmToRrf(
  rrfScores: Map<string, RrfEntry>,
  candidates: ChunkCandidate[],
  k: number,
  scoreField?: 'similarity' | 'rank',
): void {
  candidates.forEach((candidate, index) => {
    const current = rrfScores.get(candidate.chunkId) || { rrf: 0 };
    current.rrf += 1 / (k + index + 1);
    current.candidate = current.candidate ?? candidate;
    if (scoreField === 'similarity' && candidate.similarity != null) {
      current.similarity = candidate.similarity;
    }
    if (scoreField === 'rank' && candidate.rank != null) {
      current.rank = candidate.rank;
    }
    rrfScores.set(candidate.chunkId, current);
  });
}

function scoreCaseRecall(query: string, texts: string[], terms: string[]): number {
  if (texts.length === 0) return 0;
  const joined = texts.join(' ').toLowerCase();
  const hits = terms.filter((term) => joined.includes(term.toLowerCase()));
  return hits.length / terms.length;
}

export function evaluateParamsOnFixtures(
  params: LegalSearchEvalParams,
  evalCases: EvalCase[],
  fixtures: Record<string, FixtureArms>,
): {
  neg_weighted_recall: number;
  mean_recall: number;
  p95_latency_ms: number;
  per_case: Array<{ id: string; recall: number; result_count: number }>;
} {
  const start = performance.now();
  const perCase: Array<{ id: string; recall: number; result_count: number }> = [];

  for (const evalCase of evalCases) {
    const arms = fixtures[evalCase.id];
    if (!arms) {
      perCase.push({ id: evalCase.id, recall: 0, result_count: 0 });
      continue;
    }

    const fts = arms.fts.slice(0, params.FTS_CANDIDATE_LIMIT);
    const vector = arms.vector.slice(0, params.VECTOR_CANDIDATE_LIMIT);
    const exact = arms.exact;

    const rrfScores = new Map<string, RrfEntry>();
    addArmToRrf(rrfScores, exact, params.RRF_K_EXACT);
    addArmToRrf(rrfScores, vector, params.RRF_K, 'similarity');
    addArmToRrf(rrfScores, fts, params.RRF_K, 'rank');

    const sortedChunkIds = Array.from(rrfScores.keys())
      .sort((a, b) => (rrfScores.get(b)?.rrf || 0) - (rrfScores.get(a)?.rrf || 0))
      .slice(0, params.RRF_CANDIDATE_LIMIT);

    const sortedRrfValues = sortedChunkIds.map((id) => rrfScores.get(id)?.rrf || 0);
    const skipReranker =
      !params.rerankerEnabled ||
      shouldSkipReranker(sortedRrfValues, params.LEGAL_RERANKER_RELATIVE_GAP);

    let mapped = sortedChunkIds
      .map((chunkId) => {
        const entry = rrfScores.get(chunkId);
        const candidate = entry?.candidate;
        if (!candidate) return null;
        return {
          chunkText: candidate.chunkText,
          score: entry?.rrf ?? 0,
        };
      })
      .filter((row): row is { chunkText: string; score: number } => row != null);

    if (params.rerankerEnabled && !skipReranker) {
      mapped = localLexicalRerank(evalCase.query, mapped)
        .sort((a, b) => b.finalScore - a.finalScore)
        .map((row) => ({ chunkText: row.chunkText, score: row.finalScore }));
    }

    const topTexts = mapped.slice(0, params.RERANKER_FINAL_K).map((row) => row.chunkText);
    const recall = scoreCaseRecall(evalCase.query, topTexts, evalCase.must_include_terms);
    perCase.push({
      id: evalCase.id,
      recall,
      result_count: topTexts.length,
    });
  }

  const recalls = perCase.map((row) => row.recall);
  const meanRecall = recalls.reduce((sum, value) => sum + value, 0) / Math.max(recalls.length, 1);
  const elapsedMs = performance.now() - start;

  return {
    neg_weighted_recall: meanRecall,
    mean_recall: meanRecall,
    p95_latency_ms: elapsedMs,
    per_case: perCase,
  };
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function readParamsFromStdin(): LegalSearchEvalParams {
  const raw = readFileSync(0, 'utf-8').trim();
  const parsed = JSON.parse(raw || '{}') as Partial<LegalSearchEvalParams>;
  return {
    RRF_K: parsed.RRF_K ?? 60,
    RRF_K_EXACT: parsed.RRF_K_EXACT ?? 30,
    FTS_CANDIDATE_LIMIT: parsed.FTS_CANDIDATE_LIMIT ?? 50,
    VECTOR_CANDIDATE_LIMIT: parsed.VECTOR_CANDIDATE_LIMIT ?? 50,
    RRF_CANDIDATE_LIMIT: parsed.RRF_CANDIDATE_LIMIT ?? 30,
    RERANKER_FINAL_K: parsed.RERANKER_FINAL_K ?? 8,
    LEGAL_RERANKER_RELATIVE_GAP: parsed.LEGAL_RERANKER_RELATIVE_GAP ?? 0.15,
    rerankerEnabled: parsed.rerankerEnabled ?? true,
  };
}

export function main(): void {
  const params = readParamsFromStdin();
  const evalSet = loadJson<{ cases: EvalCase[] }>(join(__dirname, 'eval-set.json'));
  const fixtures = loadJson<Record<string, FixtureArms>>(join(__dirname, 'fixtures/eval-chunks.json'));
  const result = evaluateParamsOnFixtures(params, evalSet.cases, fixtures);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
