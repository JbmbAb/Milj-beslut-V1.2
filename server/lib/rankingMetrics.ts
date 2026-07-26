/**
 * Mathematical utilities for computing rank evaluation metrics in Shadow Validation mode.
 */

/**
 * Computes Kendall's Tau (rank correlation coefficient) between pre-rerank and post-rerank lists.
 * Ranges from -1.0 (perfectly reversed) to 1.0 (perfectly identical).
 */
export function computeKendallTau(preList: string[], postList: string[]): number {
  const common = preList.filter(id => postList.includes(id));
  const n = common.length;
  if (n <= 1) return 1.0;

  let concordant = 0;
  let discordant = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const itemA = common[i];
      const itemB = common[j];

      const preIndexA = preList.indexOf(itemA);
      const preIndexB = preList.indexOf(itemB);
      const postIndexA = postList.indexOf(itemA);
      const postIndexB = postList.indexOf(itemB);

      const preOrder = preIndexA < preIndexB;
      const postOrder = postIndexA < postIndexB;

      if (preOrder === postOrder) {
        concordant++;
      } else {
        discordant++;
      }
    }
  }

  const denominator = (n * (n - 1)) / 2;
  return denominator === 0 ? 1.0 : (concordant - discordant) / denominator;
}

/**
 * Computes Normalized Discounted Cumulative Gain at K (NDCG@K) using reciprocal pre-rank as relevance.
 */
export function computeNDCG(preList: string[], postList: string[], k: number): number {
  const limit = Math.min(k, preList.length);
  if (limit === 0) return 1.0;

  // Relevance is reciprocal rank in the pre-list: rel = 1 / (rank + 1)
  const getRelevance = (id: string): number => {
    const idx = preList.indexOf(id);
    return idx === -1 ? 0 : 1 / (idx + 1);
  };

  // DCG
  let dcg = 0;
  for (let i = 0; i < Math.min(k, postList.length); i++) {
    const rel = getRelevance(postList[i]);
    dcg += rel / Math.log2(i + 2);
  }

  // IDCG (Ideal DCG, which is the pre-list itself)
  let idcg = 0;
  for (let i = 0; i < limit; i++) {
    const rel = getRelevance(preList[i]);
    idcg += rel / Math.log2(i + 2);
  }

  return idcg === 0 ? 1.0 : dcg / idcg;
}

/**
 * Computes Mean Reciprocal Rank (MRR) of the pre-list's top-1 item within the post-list.
 */
export function computeMRR(preList: string[], postList: string[]): number {
  if (preList.length === 0) return 0.0;
  const targetId = preList[0];
  const rank = postList.indexOf(targetId);
  return rank === -1 ? 0.0 : 1 / (rank + 1);
}

/**
 * Computes Recall at K: proportion of the top-K pre-list items that remain in the top-K post-list.
 */
export function computeRecallAtK(preList: string[], postList: string[], k: number): number {
  const targetK = Math.min(k, preList.length);
  if (targetK === 0) return 1.0;

  const preSet = new Set(preList.slice(0, targetK));
  const postSet = new Set(postList.slice(0, targetK));

  let hits = 0;
  for (const id of preSet) {
    if (postSet.has(id)) {
      hits++;
    }
  }

  return hits / targetK;
}
