"""Ranking metrics, bootstrap CI, and Pareto selection for prompt evaluation."""

from __future__ import annotations

import math
import random
from typing import Any, Callable, Sequence


def spearman_rank(gold: Sequence[str], predicted: Sequence[str]) -> float:
    common = [item for item in gold if item in predicted]
    n = len(common)
    if n <= 1:
        return 1.0
    gold_rank = {item: idx for idx, item in enumerate(gold)}
    pred_rank = {item: idx for idx, item in enumerate(predicted)}
    d_squared = sum((gold_rank[item] - pred_rank[item]) ** 2 for item in common)
    denom = n * (n**2 - 1)
    if denom == 0:
        return 1.0
    rho = 1.0 - (6.0 * d_squared) / denom
    return max(-1.0, min(1.0, rho))


def kendall_tau(gold: Sequence[str], predicted: Sequence[str]) -> float:
    """Kendall tau-b on common items (more stable than Spearman for small lists)."""
    common = [item for item in gold if item in predicted]
    n = len(common)
    if n <= 1:
        return 1.0
    gold_rank = {item: idx for idx, item in enumerate(gold)}
    pred_rank = {item: idx for idx, item in enumerate(predicted)}
    concordant = 0
    discordant = 0
    for i in range(n):
        for j in range(i + 1, n):
            a, b = common[i], common[j]
            g_sign = gold_rank[a] - gold_rank[b]
            p_sign = pred_rank[a] - pred_rank[b]
            if g_sign == 0 or p_sign == 0:
                continue
            if (g_sign > 0) == (p_sign > 0):
                concordant += 1
            else:
                discordant += 1
    denom = concordant + discordant
    return 1.0 if denom == 0 else (concordant - discordant) / denom


def _relevance_from_gold(doc_id: str, gold: Sequence[str]) -> float:
    if doc_id not in gold:
        return 0.0
    return 1.0 / (gold.index(doc_id) + 1)


def ndcg_at_k(gold: Sequence[str], predicted: Sequence[str], k: int) -> float:
    if not gold:
        return 1.0
    limit = max(1, k)
    dcg = 0.0
    for i, doc_id in enumerate(predicted[:limit]):
        rel = _relevance_from_gold(doc_id, gold)
        dcg += rel / math.log2(i + 2)
    idcg = 0.0
    for i, doc_id in enumerate(gold[:limit]):
        rel = _relevance_from_gold(doc_id, gold)
        idcg += rel / math.log2(i + 2)
    return 1.0 if idcg == 0 else dcg / idcg


def mrr_at_k(gold: Sequence[str], predicted: Sequence[str], k: int) -> float:
    if not gold:
        return 0.0
    target = gold[0]
    for i, doc_id in enumerate(predicted[:k]):
        if doc_id == target:
            return 1.0 / (i + 1)
    return 0.0


def precision_at_k(gold: Sequence[str], predicted: Sequence[str], k: int) -> float:
    if k <= 0:
        return 0.0
    gold_set = set(gold)
    hits = sum(1 for doc_id in predicted[:k] if doc_id in gold_set)
    return hits / k


def recall_at_k(gold: Sequence[str], predicted: Sequence[str], k: int) -> float:
    if not gold:
        return 1.0
    gold_set = set(gold)
    hits = sum(1 for doc_id in predicted[:k] if doc_id in gold_set)
    return hits / len(gold_set)


def hit_rate_at_k(gold: Sequence[str], predicted: Sequence[str], k: int) -> float:
    if not gold:
        return 1.0
    top_gold = gold[0]
    return 1.0 if top_gold in predicted[:k] else 0.0


def average_precision(gold: Sequence[str], predicted: Sequence[str]) -> float:
    if not gold:
        return 1.0
    gold_set = set(gold)
    hits = 0
    sum_prec = 0.0
    for i, doc_id in enumerate(predicted):
        if doc_id in gold_set:
            hits += 1
            sum_prec += hits / (i + 1)
    return sum_prec / len(gold_set)


def err_at_k(gold: Sequence[str], predicted: Sequence[str], k: int) -> float:
    """Expected Reciprocal Rank@k."""
    if not gold:
        return 1.0
    limit = max(1, k)
    p_not_found = 1.0
    err = 0.0
    gold_set = set(gold)
    for i, doc_id in enumerate(predicted[:limit]):
        p_relevant = 1.0 if doc_id in gold_set else 0.0
        err += p_not_found * p_relevant / (i + 1)
        p_not_found *= 1.0 - p_relevant
    return err


def compute_all_metrics(gold: Sequence[str], predicted: Sequence[str], k: int) -> dict[str, float]:
    return {
        'spearman': spearman_rank(gold, predicted),
        'kendall_tau': kendall_tau(gold, predicted),
        f'ndcg{k}': ndcg_at_k(gold, predicted, k),
        f'mrr{k}': mrr_at_k(gold, predicted, k),
        f'precision{k}': precision_at_k(gold, predicted, k),
        f'recall{k}': recall_at_k(gold, predicted, k),
        f'hit_rate{k}': hit_rate_at_k(gold, predicted, k),
        'map': average_precision(gold, predicted),
        f'err{k}': err_at_k(gold, predicted, k),
    }


def percentile(values: Sequence[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    rank = (pct / 100.0) * (len(ordered) - 1)
    lower = int(math.floor(rank))
    upper = int(math.ceil(rank))
    if lower == upper:
        return ordered[lower]
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def bootstrap_ci(
    values: Sequence[float],
    *,
    n_resamples: int = 1000,
    confidence: float = 0.95,
    seed: int = 42,
    stat: Callable[[Sequence[float]], float] = lambda xs: sum(xs) / len(xs),
) -> dict[str, float]:
    if not values:
        return {'mean': 0.0, 'lower': 0.0, 'upper': 0.0, 'std': 0.0}
    rng = random.Random(seed)
    n = len(values)
    samples: list[float] = []
    for _ in range(n_resamples):
        draw = [values[rng.randrange(n)] for _ in range(n)]
        samples.append(stat(draw))
    samples.sort()
    alpha = (1.0 - confidence) / 2.0
    lo_idx = int(alpha * len(samples))
    hi_idx = int((1.0 - alpha) * len(samples)) - 1
    mean = stat(values)
    variance = sum((x - mean) ** 2 for x in values) / max(n - 1, 1)
    return {
        'mean': round(mean, 6),
        'lower': round(samples[max(lo_idx, 0)], 6),
        'upper': round(samples[min(hi_idx, len(samples) - 1)], 6),
        'std': round(math.sqrt(variance), 6),
    }


def pareto_frontier(variants: list[dict[str, Any]]) -> list[str]:
    """
    Non-dominated variants maximizing quality metrics, minimizing cost/latency/failures.
    """
    if not variants:
        return []

    def dominates(a: dict[str, Any], b: dict[str, Any]) -> bool:
        """True if a dominates b (a >= quality, a <= cost, strict on at least one)."""
        better_or_equal = True
        strictly_better = False

        for key in ('mean_ndcg', 'mean_spearman', 'mean_mrr', 'mean_map', 'mean_kendall_tau'):
            av = a.get(key, 0.0)
            bv = b.get(key, 0.0)
            if av < bv:
                better_or_equal = False
                break
            if av > bv:
                strictly_better = True

        for key in ('p95_latency_s', 'est_cost_usd', 'failure_rate'):
            av = a.get(key, 0.0)
            bv = b.get(key, 0.0)
            if av > bv:
                better_or_equal = False
                break
            if av < bv:
                strictly_better = True

        return better_or_equal and strictly_better

    frontier: list[str] = []
    for v in variants:
        vid = v['variant_id']
        if any(dominates(other, v) for other in variants if other['variant_id'] != vid):
            continue
        frontier.append(vid)
    return frontier


def pick_winner_pareto(
    variants: list[dict[str, Any]],
    *,
    latency_budget_s: float | None = None,
    primary_metric: str = 'mean_ndcg',
) -> dict[str, Any]:
    """
    Choose highest primary metric on Pareto frontier, optionally under latency budget.
    """
    if not variants:
        raise ValueError('No variants to pick from')

    budget = latency_budget_s
    if budget is None:
        budget = float(__import__('os').environ.get('LATENCY_BUDGET_P95_S', '0') or '0') or None

    frontier_ids = set(pareto_frontier(variants))
    candidates = [v for v in variants if v['variant_id'] in frontier_ids] or variants

    if budget is not None:
        under_budget = [v for v in candidates if v.get('p95_latency_s', 999) <= budget]
        if under_budget:
            candidates = under_budget

    return max(
        candidates,
        key=lambda v: (
            v.get(primary_metric, 0.0),
            v.get('mean_spearman', 0.0),
            -v.get('p95_latency_s', 999),
            -v.get('est_cost_usd', 999),
        ),
    )
