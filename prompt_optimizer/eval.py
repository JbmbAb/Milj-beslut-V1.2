"""Evaluate prompt variants with resume, rate limits, failure budget, and Pareto selection."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from checkpoint import save_checkpoint
from metrics import (
    bootstrap_ci,
    compute_all_metrics,
    pareto_frontier,
    percentile,
    pick_winner_pareto,
)
from rate_limiter import RateLimiter
from rerank_client import RerankClient

RERANK_TIMEOUT = float(os.environ.get("RERANK_TIMEOUT", "6"))
MAX_WORKERS = int(os.environ.get("MAX_CONCURRENT_QUERIES", "8"))
NDCG_K = int(os.environ.get("EVAL_NDCG_K", "10"))
FAILURE_BUDGET = float(os.environ.get("MAX_FAILURE_RATE", "0.02"))
WARNING_FAILURE_RATE = float(os.environ.get("WARNING_FAILURE_RATE", "0.02"))
HARD_FAILURE_RATE = float(os.environ.get("HARD_FAILURE_RATE", "0.05"))
CHECKPOINT_INTERVAL = int(os.environ.get("CHECKPOINT_INTERVAL", "50"))
BOOTSTRAP_SAMPLES = int(os.environ.get("BOOTSTRAP_SAMPLES", "1000"))
EVAL_SEED = int(os.environ.get("EVAL_SEED", "42"))
# ProcessPool requires picklable workers; network-bound rerank uses threads.
EXECUTOR_MODE = "thread"


def normalize_record(record: dict[str, Any]) -> dict[str, Any]:
    query_id = str(record.get("query_id") or record.get("id") or "")
    query = str(record.get("query") or "")
    gold_ranking = list(record.get("gold_ranking") or [])

    raw_docs = record.get("candidates") or record.get("context_documents") or []
    candidates: list[dict[str, Any]] = []
    for idx, doc in enumerate(raw_docs):
        if not isinstance(doc, dict):
            continue
        cid = str(doc.get("id") or doc.get("doc_id") or f"doc-{idx}")
        text = str(doc.get("chunkText") or doc.get("text") or "")
        score = float(doc.get("score", max(0.1, 1.0 - idx * 0.05)))
        candidates.append({"id": cid, "chunkText": text, "score": score})

    return {
        "query_id": query_id,
        "query": query,
        "gold_ranking": gold_ranking,
        "candidates": candidates,
    }


def _lexical_fallback_rank(
    query: str, candidates: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Fallback ranking when rerank API fails after retries."""
    terms = [t for t in query.lower().split() if len(t) > 2]
    scored = []
    for c in candidates:
        text = (c.get("chunkText") or c.get("text", "")).lower()
        matches = sum(1 for t in terms if t in text)
        scored.append(
            {"id": c["id"], "score": float(c.get("score", 0.5)) + matches * 0.1}
        )
    scored.sort(key=lambda row: row["score"], reverse=True)
    return scored


def _append_per_query_log(path: str, row: dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def _log_query_row(
    row: dict[str, Any],
    *,
    per_query_log_path: str | None,
    checkpoint_path: str | None,
    variant_id: str,
    processed_count: int,
) -> None:
    if per_query_log_path:
        _append_per_query_log(per_query_log_path, row)
    if checkpoint_path:
        save_checkpoint(
            variant_id=variant_id,
            last_query_id=str(row["query_id"]),
            processed_count=processed_count,
            path=checkpoint_path,
        )


def _aggregate_metric_lists(
    per_query: list[dict[str, Any]], prefix: str
) -> dict[str, float]:
    keys = [k for k in per_query[0].keys() if k.startswith(prefix)] if per_query else []
    out: dict[str, float] = {}
    for key in keys:
        vals = [float(row[key]) for row in per_query if not row.get("failed")]
        out[f"mean_{key}"] = sum(vals) / len(vals) if vals else 0.0
    return out


def load_cached_row(
    record: dict[str, Any],
    prompt_template: str,
    variant_id: str,
    client: Any,
    k: int = NDCG_K,
) -> dict[str, Any] | None:
    from cache import build_cache_key, candidate_hash as cand_hash_fn

    prompt_hash = hashlib.sha256(prompt_template.encode("utf-8")).hexdigest()[:16]
    cand_hash = cand_hash_fn(record["candidates"])
    cache_key = build_cache_key(
        prompt_hash=prompt_hash,
        query_id=record["query_id"],
        candidate_hash=cand_hash,
        reranker_version=client.reranker_version,
    )
    cached = client.persistent_cache.get(cache_key)
    if cached is None:
        return None
    ranked_ids = [
        str(it["id"])
        for it in sorted(cached["ranking"], key=lambda x: x["score"], reverse=True)
    ]
    gold = [str(g) for g in record["gold_ranking"]]
    metrics = compute_all_metrics(gold, ranked_ids, k)
    return {
        "query_id": record["query_id"],
        "variant": variant_id,
        "latency_ms": cached["latency"].get("total_ms", 0),
        "latency": cached["latency"],
        "tokens_in": cached["tokens_in"],
        "tokens_out": cached["tokens_out"],
        "cost_usd": cached["cost_usd"],
        "cached": True,
        "failed": False,
        "failures": 0,
        "engine": cached.get("engine", getattr(client, "mode", "unknown")),
        "predicted_ranking": ranked_ids,
        "gold_ranking": gold,
        **metrics,
    }


def score_prompt_variant_sync(
    records: list[dict[str, Any]],
    prompt_template: str,
    *,
    variant_id: str,
    client: RerankClient,
    k: int = NDCG_K,
    max_workers: int = MAX_WORKERS,
    max_cost_usd: float | None = None,
    rate_limiter: RateLimiter | None = None,
    per_query_log_path: str | None = None,
    checkpoint_path: str | None = None,
) -> dict[str, Any]:
    """Run real rerank calls with persistent cache resume and failure budget."""
    normalized = [
        normalize_record(r)
        for r in records
        if r.get("query") and (r.get("gold_ranking") or [])
    ]
    prompt_hash = hashlib.sha256(prompt_template.encode("utf-8")).hexdigest()[:16]

    per_query_log_path = (
        per_query_log_path or os.environ.get("PER_QUERY_LOG_PATH") or None
    )
    checkpoint_path = checkpoint_path or os.environ.get("EVAL_CHECKPOINT_PATH") or None

    cached_ids = client.persistent_cache.list_cached_query_ids(variant_id, prompt_hash)
    pending = [r for r in normalized if r["query_id"] not in cached_ids]
    resumed = len(normalized) - len(pending)

    limiter = rate_limiter or RateLimiter()
    semaphore = threading.Semaphore(max_workers)
    per_query: list[dict[str, Any]] = []
    failures = 0
    total_token_cost = 0.0
    aborted_cost = False
    aborted_failures = False
    degraded = False
    lock = threading.Lock()

    def eval_one(record: dict[str, Any]) -> dict[str, Any]:
        nonlocal failures, total_token_cost, aborted_cost, aborted_failures, degraded

        with semaphore:
            queue_start = time.perf_counter()
            est_tokens = (
                sum(len(c.get("chunkText", "")) for c in record["candidates"]) // 4
                + 256
            )
            limiter.acquire(estimated_tokens=est_tokens)
            queue_ms = (time.perf_counter() - queue_start) * 1000

            try:
                resp = client.rerank(
                    query=record["query"],
                    candidates=record["candidates"],
                    prompt_template=prompt_template,
                    query_id=record["query_id"],
                    variant_id=variant_id,
                    timeout=RERANK_TIMEOUT,
                    queue_ms=queue_ms,
                )
                limiter.record_tokens(
                    resp.input_tokens + resp.output_tokens, est_tokens
                )

                ranked_ids = [
                    str(it["id"])
                    for it in sorted(resp.items, key=lambda x: x["score"], reverse=True)
                ]
                gold = [str(g) for g in record["gold_ranking"]]
                metrics = compute_all_metrics(gold, ranked_ids, k)

                row = {
                    "query_id": record["query_id"],
                    "variant": variant_id,
                    "latency_ms": resp.latency.total_ms,
                    "latency": resp.latency.to_dict(),
                    "tokens_in": resp.input_tokens,
                    "tokens_out": resp.output_tokens,
                    "cost_usd": resp.token_cost,
                    "cached": resp.cached,
                    "failed": False,
                    "failures": 0,
                    "engine": resp.engine,
                    "predicted_ranking": ranked_ids,
                    "gold_ranking": gold,
                    **metrics,
                }
            except Exception as err:
                fallback = _lexical_fallback_rank(record["query"], record["candidates"])
                ranked_ids = [str(it["id"]) for it in fallback]
                gold = [str(g) for g in record["gold_ranking"]]
                metrics = compute_all_metrics(gold, ranked_ids, k)
                row = {
                    "query_id": record["query_id"],
                    "variant": variant_id,
                    "latency_ms": RERANK_TIMEOUT * 1000,
                    "latency": {"total_ms": RERANK_TIMEOUT * 1000},
                    "tokens_in": 0,
                    "tokens_out": 0,
                    "cost_usd": 0.0,
                    "cached": False,
                    "failed": True,
                    "failures": 1,
                    "fallback": "lexical",
                    "error": str(err),
                    "engine": client.mode,
                    "predicted_ranking": ranked_ids,
                    "gold_ranking": gold,
                    **metrics,
                }

            with lock:
                per_query.append(row)
                if row.get("failed"):
                    failures += 1
                else:
                    total_token_cost += row["cost_usd"]

                n_done = len(per_query)
                fail_rate = failures / n_done if n_done else 0.0
                if fail_rate > WARNING_FAILURE_RATE and n_done >= max(
                    10, len(normalized) // 20
                ):
                    degraded = True
                if fail_rate > HARD_FAILURE_RATE and n_done >= max(
                    10, len(normalized) // 20
                ):
                    aborted_failures = True
                if max_cost_usd is not None and total_token_cost > max_cost_usd:
                    aborted_cost = True
                if per_query_log_path:
                    _append_per_query_log(per_query_log_path, row)
                if checkpoint_path and n_done % CHECKPOINT_INTERVAL == 0:
                    save_checkpoint(
                        variant_id=variant_id,
                        last_query_id=str(row["query_id"]),
                        processed_count=n_done,
                        path=checkpoint_path,
                    )

            return row

    for rec in normalized:
        if rec["query_id"] in cached_ids:
            row = load_cached_row(rec, prompt_template, variant_id, client, k)
            if row:
                per_query.append(row)
                total_token_cost += row["cost_usd"]

    remaining = [
        r for r in normalized if r["query_id"] not in {p["query_id"] for p in per_query}
    ]

    if remaining:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(eval_one, rec): rec for rec in remaining}
            for future in as_completed(futures):
                future.result()
                if aborted_cost or aborted_failures:
                    for pending_future in futures:
                        pending_future.cancel()
                    break

    successful = [r for r in per_query if not r.get("failed")]
    n = max(len(per_query), 1)
    latencies = [r["latency_ms"] / 1000.0 for r in per_query]

    ndcg_vals = [r.get(f"ndcg{k}", 0.0) for r in successful]
    spearman_vals = [r.get("spearman", 0.0) for r in successful]
    mrr_vals = [r.get(f"mrr{k}", 0.0) for r in successful]
    map_vals = [r.get("map", 0.0) for r in successful]
    kendall_vals = [r.get("kendall_tau", 0.0) for r in successful]

    ndcg_ci = bootstrap_ci(ndcg_vals, n_resamples=BOOTSTRAP_SAMPLES, seed=EVAL_SEED)
    spearman_ci = bootstrap_ci(
        spearman_vals, n_resamples=BOOTSTRAP_SAMPLES, seed=EVAL_SEED + 1
    )
    latency_ci = bootstrap_ci(
        latencies, n_resamples=BOOTSTRAP_SAMPLES, seed=EVAL_SEED + 2
    )

    result = {
        "variant_id": variant_id,
        "prompt_hash": prompt_hash,
        "prompt_preview": prompt_template[:240],
        "n_queries": len(normalized),
        "n_evaluated": len(per_query),
        "n_resumed_from_cache": resumed,
        "mean_spearman": (
            sum(spearman_vals) / len(spearman_vals) if spearman_vals else 0.0
        ),
        "mean_kendall_tau": (
            sum(kendall_vals) / len(kendall_vals) if kendall_vals else 0.0
        ),
        "mean_ndcg": sum(ndcg_vals) / len(ndcg_vals) if ndcg_vals else 0.0,
        f"mean_ndcg{k}": sum(ndcg_vals) / len(ndcg_vals) if ndcg_vals else 0.0,
        "mean_mrr": sum(mrr_vals) / len(mrr_vals) if mrr_vals else 0.0,
        f"mean_mrr{k}": sum(mrr_vals) / len(mrr_vals) if mrr_vals else 0.0,
        "mean_map": sum(map_vals) / len(map_vals) if map_vals else 0.0,
        "p50_latency_s": percentile(latencies, 50),
        "p95_latency_s": percentile(latencies, 95),
        "mean_latency_s": sum(latencies) / n,
        "est_cost_usd": round(total_token_cost, 6),
        "est_cost_per_query_usd": round(total_token_cost / max(len(successful), 1), 8),
        "failure_rate": failures / n,
        "failures": failures,
        "degraded": degraded,
        "aborted_cost_limit": aborted_cost,
        "aborted_failure_budget": aborted_failures,
        "confidence_intervals": {
            f"ndcg{k}": ndcg_ci,
            "spearman": spearman_ci,
            "p95_latency_s": latency_ci,
        },
        "per_query": per_query,
        "eval_mode": "sync",
    }
    result.update(_aggregate_metric_lists(successful, prefix="precision"))
    result.update(_aggregate_metric_lists(successful, prefix="recall"))
    result.update(_aggregate_metric_lists(successful, prefix="hit_rate"))
    return result


def score_prompt_variant(
    records: list[dict[str, Any]],
    prompt_template: str,
    *,
    variant_id: str,
    client: Any,
    k: int = NDCG_K,
    max_workers: int = MAX_WORKERS,
    max_cost_usd: float | None = None,
    rate_limiter: Any | None = None,
    per_query_log_path: str | None = None,
    checkpoint_path: str | None = None,
    eval_mode: str | None = None,
) -> dict[str, Any]:
    """Dispatch to async or sync evaluation."""
    mode = (eval_mode or os.environ.get("EVAL_MODE", "sync")).lower()
    if mode == "async":
        import asyncio

        from async_rate_limiter import AsyncRateLimiter
        from eval_async import score_prompt_variant_async
        from rerank_client import RerankClient

        async_limiter = (
            rate_limiter
            if isinstance(rate_limiter, AsyncRateLimiter)
            else AsyncRateLimiter()
        )
        sync_client = client if isinstance(client, RerankClient) else None
        async_client = client if not isinstance(client, RerankClient) else client
        return asyncio.run(
            score_prompt_variant_async(
                records,
                prompt_template,
                variant_id=variant_id,
                client=async_client,
                k=k,
                max_cost_usd=max_cost_usd,
                rate_limiter=async_limiter,
                per_query_log_path=per_query_log_path,
                checkpoint_path=checkpoint_path,
                sync_client=sync_client,
            )
        )
    return score_prompt_variant_sync(
        records,
        prompt_template,
        variant_id=variant_id,
        client=client,
        k=k,
        max_workers=max_workers,
        max_cost_usd=max_cost_usd,
        rate_limiter=rate_limiter,
        per_query_log_path=per_query_log_path,
        checkpoint_path=checkpoint_path,
    )


def pick_best_variant(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Pareto-based winner selection."""
    return pick_winner_pareto(results, primary_metric="mean_ndcg")


def build_pareto_summary(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    frontier_ids = set(pareto_frontier(results))
    return [
        {
            "variant_id": r["variant_id"],
            "on_frontier": r["variant_id"] in frontier_ids,
            "mean_ndcg": r.get("mean_ndcg"),
            "mean_spearman": r.get("mean_spearman"),
            "mean_mrr": r.get("mean_mrr"),
            "mean_map": r.get("mean_map"),
            "p95_latency_s": r.get("p95_latency_s"),
            "est_cost_usd": r.get("est_cost_usd"),
            "failure_rate": r.get("failure_rate"),
            "confidence_intervals": r.get("confidence_intervals"),
        }
        for r in results
    ]
