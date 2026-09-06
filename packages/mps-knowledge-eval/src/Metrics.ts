/**
 * One metrics kernel, pure and dependency-free. Definitions (binary relevance):
 *
 *   hit@k        1 if any relevant item is ranked <= k, else 0
 *   recall@k     |relevant items ranked <= k| / min(|relevant items in the evaluated pool|, k)
 *                (capped recall: a query whose 40 relevant chunks cannot all fit in the top 5 is not
 *                penalized for the pool being larger than k)
 *   RR           1 / rank of the first relevant item (0 if none)
 *   nDCG@k       binary-gain DCG normalized by the ideal DCG for min(|relevant|, k) items
 */
export function hitAtK(relevance: readonly boolean[], k: number): number {
  return relevance.slice(0, k).some(Boolean) ? 1 : 0;
}

export function recallAtK(relevance: readonly boolean[], totalRelevant: number, k: number): number {
  const denominator = Math.min(totalRelevant, k);
  if (denominator <= 0) return 0;
  return relevance.slice(0, k).filter(Boolean).length / denominator;
}

export function reciprocalRank(relevance: readonly boolean[]): number {
  const idx = relevance.findIndex(Boolean);
  return idx < 0 ? 0 : 1 / (idx + 1);
}

export function ndcgAtK(relevance: readonly boolean[], totalRelevant: number, k: number): number {
  const dcg = relevance.slice(0, k).reduce((sum, rel, i) => sum + (rel ? 1 / Math.log2(i + 2) : 0), 0);
  const ideal = Math.min(totalRelevant, k);
  if (ideal <= 0) return 0;
  let idcg = 0;
  for (let i = 0; i < ideal; i++) idcg += 1 / Math.log2(i + 2);
  return dcg / idcg;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Rounds for stable, reviewable reports; identity-bearing values are never rounded. */
export function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}
