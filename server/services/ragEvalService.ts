/**
 * Lightweight RAG evaluation harness (precision, recall, faithfulness, citations, cache hit rate).
 * Modular under server/services — no monolith.
 */

export interface RagEvalCase {
  query: string;
  /** Expected document or chunk ids that should appear in sources */
  relevantIds: string[];
  /** Optional gold answer keywords for faithfulness heuristic */
  goldKeywords?: string[];
}

export interface RagEvalSource {
  documentId?: string;
  chunkId?: string;
  score?: number;
}

export interface RagEvalRunResult {
  answer: string;
  sources: RagEvalSource[];
  cacheHit?: boolean;
}

export interface RagEvalMetrics {
  caseCount: number;
  precision: number;
  recall: number;
  faithfulness: number;
  citationAccuracy: number;
  embeddingCacheHitRate: number;
  perCase: Array<{
    query: string;
    precision: number;
    recall: number;
    faithfulness: number;
    citationAccuracy: number;
    cacheHit: boolean;
  }>;
}

function sourceIds(sources: RagEvalSource[]): string[] {
  const ids = new Set<string>();
  for (const s of sources) {
    if (s.chunkId) ids.add(s.chunkId);
    if (s.documentId) ids.add(s.documentId);
  }
  return [...ids];
}

function precisionAt(retrieved: string[], relevant: string[]): number {
  if (!retrieved.length) return relevant.length === 0 ? 1 : 0;
  const rel = new Set(relevant);
  const hits = retrieved.filter((id) => rel.has(id)).length;
  return hits / retrieved.length;
}

function recallAt(retrieved: string[], relevant: string[]): number {
  if (!relevant.length) return 1;
  const ret = new Set(retrieved);
  const hits = relevant.filter((id) => ret.has(id)).length;
  return hits / relevant.length;
}

/** Keyword overlap faithfulness heuristic (0–1). */
export function faithfulnessScore(answer: string, goldKeywords: string[] = []): number {
  if (!goldKeywords.length) {
    return answer.trim().length > 0 ? 0.5 : 0;
  }
  const lower = answer.toLowerCase();
  const hits = goldKeywords.filter((k) => lower.includes(k.toLowerCase())).length;
  return hits / goldKeywords.length;
}

/** Citation accuracy: fraction of cited ids that are in the relevant set. */
function citationAccuracy(retrieved: string[], relevant: string[]): number {
  if (!retrieved.length) return 0;
  const rel = new Set(relevant);
  return retrieved.filter((id) => rel.has(id)).length / retrieved.length;
}

export function evaluateRagRuns(
  cases: RagEvalCase[],
  runs: RagEvalRunResult[],
): RagEvalMetrics {
  if (cases.length !== runs.length) {
    throw new Error(`RAG eval case/run length mismatch: ${cases.length} vs ${runs.length}`);
  }

  const perCase = cases.map((c, i) => {
    const run = runs[i];
    const retrieved = sourceIds(run.sources);
    const precision = precisionAt(retrieved, c.relevantIds);
    const recall = recallAt(retrieved, c.relevantIds);
    const faithfulness = faithfulnessScore(run.answer, c.goldKeywords);
    const citation = citationAccuracy(retrieved, c.relevantIds);
    return {
      query: c.query,
      precision,
      recall,
      faithfulness,
      citationAccuracy: citation,
      cacheHit: Boolean(run.cacheHit),
    };
  });

  const avg = (key: 'precision' | 'recall' | 'faithfulness' | 'citationAccuracy') =>
    perCase.reduce((s, r) => s + r[key], 0) / (perCase.length || 1);

  const cacheHits = perCase.filter((r) => r.cacheHit).length;

  return {
    caseCount: perCase.length,
    precision: avg('precision'),
    recall: avg('recall'),
    faithfulness: avg('faithfulness'),
    citationAccuracy: avg('citationAccuracy'),
    embeddingCacheHitRate: cacheHits / (perCase.length || 1),
    perCase,
  };
}
