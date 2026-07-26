"""Async evaluation loop — httpx rerank client + AsyncRateLimiter."""

from __future__ import annotations

import asyncio
import hashlib
import os
import time
from typing import Any, Protocol

from async_rate_limiter import AsyncRateLimiter
from checkpoint import save_checkpoint
from metrics import bootstrap_ci, compute_all_metrics, percentile

from eval import (
    BOOTSTRAP_SAMPLES,
    EVAL_SEED,
    NDCG_K,
    RERANK_TIMEOUT,
    _aggregate_metric_lists,
    _append_per_query_log,
    _lexical_fallback_rank,
    normalize_record,
)

WARNING_FAILURE_RATE = float(os.environ.get('WARNING_FAILURE_RATE', '0.02'))
HARD_FAILURE_RATE = float(os.environ.get('HARD_FAILURE_RATE', '0.05'))
CHECKPOINT_INTERVAL = int(os.environ.get('CHECKPOINT_INTERVAL', '50'))


class AsyncRerankLike(Protocol):
    mode: str
    reranker_version: str
    persistent_cache: Any

    async def rerank(self, **kwargs: Any) -> Any: ...


def _row_from_response(record: dict[str, Any], resp: Any, *, variant_id: str, k: int) -> dict[str, Any]:
    ranked_ids = [str(it['id']) for it in sorted(resp.items, key=lambda x: x['score'], reverse=True)]
    gold = [str(g) for g in record['gold_ranking']]
    metrics = compute_all_metrics(gold, ranked_ids, k)
    return {
        'query_id': record['query_id'],
        'variant': variant_id,
        'latency_ms': resp.latency.total_ms,
        'latency': resp.latency.to_dict(),
        'tokens_in': resp.input_tokens,
        'tokens_out': resp.output_tokens,
        'cost_usd': resp.token_cost,
        'cached': resp.cached,
        'failed': False,
        'failures': 0,
        'engine': resp.engine,
        'predicted_ranking': ranked_ids,
        'gold_ranking': gold,
        **metrics,
    }


async def score_prompt_variant_async(
    records: list[dict[str, Any]],
    prompt_template: str,
    *,
    variant_id: str,
    client: AsyncRerankLike,
    k: int = NDCG_K,
    max_cost_usd: float | None = None,
    rate_limiter: AsyncRateLimiter | None = None,
    per_query_log_path: str | None = None,
    checkpoint_path: str | None = None,
    sync_client: Any | None = None,
) -> dict[str, Any]:
    """Evaluate variant asynchronously (HTTP async client or sync client via to_thread)."""
    normalized = [normalize_record(r) for r in records if r.get('query') and (r.get('gold_ranking') or [])]
    prompt_hash = hashlib.sha256(prompt_template.encode('utf-8')).hexdigest()[:16]
    per_query_log_path = per_query_log_path or os.environ.get('PER_QUERY_LOG_PATH') or None
    checkpoint_path = checkpoint_path or os.environ.get('EVAL_CHECKPOINT_PATH') or None

    cached_ids = client.persistent_cache.list_cached_query_ids(variant_id, prompt_hash)
    resumed = len([r for r in normalized if r['query_id'] in cached_ids])

    limiter = rate_limiter or AsyncRateLimiter()
    per_query: list[dict[str, Any]] = []
    failures = 0
    total_token_cost = 0.0
    aborted_cost = False
    aborted_failures = False
    degraded = False
    lock = asyncio.Lock()
    state = {'failures': 0, 'cost': 0.0, 'aborted_cost': False, 'aborted_failures': False, 'degraded': False}

    async def call_rerank(record: dict[str, Any], queue_ms: float) -> Any:
        kwargs = {
            'query': record['query'],
            'candidates': record['candidates'],
            'prompt_template': prompt_template,
            'query_id': record['query_id'],
            'variant_id': variant_id,
            'queue_ms': queue_ms,
        }
        if sync_client is not None:
            return await asyncio.to_thread(
                sync_client.rerank,
                query=record['query'],
                candidates=record['candidates'],
                prompt_template=prompt_template,
                query_id=record['query_id'],
                variant_id=variant_id,
                timeout=RERANK_TIMEOUT,
                queue_ms=queue_ms,
            )
        return await client.rerank(**kwargs)

    async def eval_one(record: dict[str, Any]) -> dict[str, Any]:
        est_tokens = sum(len(c.get('chunkText', '')) for c in record['candidates']) // 4 + 256
        queue_start = time.perf_counter()
        async with limiter.acquire(estimated_tokens=est_tokens):
            queue_ms = (time.perf_counter() - queue_start) * 1000
            try:
                resp = await call_rerank(record, queue_ms)
                await limiter.record_tokens(resp.input_tokens + resp.output_tokens, est_tokens)
                row = _row_from_response(record, resp, variant_id=variant_id, k=k)
            except Exception as err:
                fallback = _lexical_fallback_rank(record['query'], record['candidates'])
                ranked_ids = [str(it['id']) for it in fallback]
                gold = [str(g) for g in record['gold_ranking']]
                metrics = compute_all_metrics(gold, ranked_ids, k)
                row = {
                    'query_id': record['query_id'],
                    'variant': variant_id,
                    'latency_ms': RERANK_TIMEOUT * 1000,
                    'latency': {'total_ms': RERANK_TIMEOUT * 1000},
                    'tokens_in': 0,
                    'tokens_out': 0,
                    'cost_usd': 0.0,
                    'cached': False,
                    'failed': True,
                    'failures': 1,
                    'fallback': 'lexical',
                    'error': str(err),
                    'engine': getattr(client, 'mode', 'async'),
                    'predicted_ranking': ranked_ids,
                    'gold_ranking': gold,
                    **metrics,
                }

        async with lock:
            per_query.append(row)
            n_done = len(per_query)
            if row.get('failed'):
                state['failures'] += 1
            else:
                state['cost'] += row['cost_usd']
            fail_rate = state['failures'] / n_done if n_done else 0.0
            if fail_rate > WARNING_FAILURE_RATE and n_done >= max(10, len(normalized) // 20):
                state['degraded'] = True
            if fail_rate > HARD_FAILURE_RATE and n_done >= max(10, len(normalized) // 20):
                state['aborted_failures'] = True
            if max_cost_usd is not None and state['cost'] > max_cost_usd:
                state['aborted_cost'] = True
            if per_query_log_path:
                _append_per_query_log(per_query_log_path, row)
            if checkpoint_path and n_done % CHECKPOINT_INTERVAL == 0:
                save_checkpoint(
                    variant_id=variant_id,
                    last_query_id=str(row['query_id']),
                    processed_count=n_done,
                    path=checkpoint_path,
                )

        return row

    # hydrate cached rows synchronously via thread pool
    from eval import load_cached_row

    for rec in normalized:
        if rec['query_id'] in cached_ids:
            row = load_cached_row(rec, prompt_template, variant_id, client, k)
            if row:
                per_query.append(row)
                total_token_cost += row['cost_usd']

    remaining = [r for r in normalized if r['query_id'] not in {p['query_id'] for p in per_query}]
    if remaining:
        tasks = [asyncio.create_task(eval_one(rec)) for rec in remaining]
        for task in asyncio.as_completed(tasks):
            await task
            if state['aborted_cost'] or state['aborted_failures']:
                for t in tasks:
                    t.cancel()
                break

    failures = state['failures']
    total_token_cost = state['cost']
    aborted_cost = state['aborted_cost']
    aborted_failures = state['aborted_failures']
    degraded = state['degraded']

    if hasattr(client, 'aclose'):
        await client.aclose()

    successful = [r for r in per_query if not r.get('failed')]
    n = max(len(per_query), 1)
    latencies = [r['latency_ms'] / 1000.0 for r in per_query]
    ndcg_vals = [r.get(f'ndcg{k}', 0.0) for r in successful]
    spearman_vals = [r.get('spearman', 0.0) for r in successful]
    mrr_vals = [r.get(f'mrr{k}', 0.0) for r in successful]
    map_vals = [r.get('map', 0.0) for r in successful]
    kendall_vals = [r.get('kendall_tau', 0.0) for r in successful]

    ndcg_ci = bootstrap_ci(ndcg_vals, n_resamples=BOOTSTRAP_SAMPLES, seed=EVAL_SEED)
    spearman_ci = bootstrap_ci(spearman_vals, n_resamples=BOOTSTRAP_SAMPLES, seed=EVAL_SEED + 1)
    latency_ci = bootstrap_ci(latencies, n_resamples=BOOTSTRAP_SAMPLES, seed=EVAL_SEED + 2)

    result = {
        'variant_id': variant_id,
        'prompt_hash': prompt_hash,
        'prompt_preview': prompt_template[:240],
        'n_queries': len(normalized),
        'n_evaluated': len(per_query),
        'n_resumed_from_cache': resumed,
        'mean_spearman': sum(spearman_vals) / len(spearman_vals) if spearman_vals else 0.0,
        'mean_kendall_tau': sum(kendall_vals) / len(kendall_vals) if kendall_vals else 0.0,
        'mean_ndcg': sum(ndcg_vals) / len(ndcg_vals) if ndcg_vals else 0.0,
        f'mean_ndcg{k}': sum(ndcg_vals) / len(ndcg_vals) if ndcg_vals else 0.0,
        'mean_mrr': sum(mrr_vals) / len(mrr_vals) if mrr_vals else 0.0,
        f'mean_mrr{k}': sum(mrr_vals) / len(mrr_vals) if mrr_vals else 0.0,
        'mean_map': sum(map_vals) / len(map_vals) if map_vals else 0.0,
        'p50_latency_s': percentile(latencies, 50),
        'p95_latency_s': percentile(latencies, 95),
        'mean_latency_s': sum(latencies) / n,
        'est_cost_usd': round(total_token_cost, 6),
        'est_cost_per_query_usd': round(total_token_cost / max(len(successful), 1), 8),
        'failure_rate': failures / n,
        'failures': failures,
        'degraded': degraded,
        'aborted_cost_limit': aborted_cost,
        'aborted_failure_budget': aborted_failures,
        'confidence_intervals': {
            f'ndcg{k}': ndcg_ci,
            'spearman': spearman_ci,
            'p95_latency_s': latency_ci,
        },
        'per_query': per_query,
        'eval_mode': 'async',
    }
    result.update(_aggregate_metric_lists(successful, prefix='precision'))
    result.update(_aggregate_metric_lists(successful, prefix='recall'))
    result.update(_aggregate_metric_lists(successful, prefix='hit_rate'))
    return result
