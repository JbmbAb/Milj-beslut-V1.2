# prompt_optimizer/main.py
"""
Vertex AI Prompt Optimizer — production-grade rerank prompt evaluation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any
from urllib.parse import urlparse

from algorithm import build_variants
from cache import PersistentCache
from config import get_config, reset_config_cache
from constants import RESULTS_SCHEMA_VERSION
from eval import (
    HARD_FAILURE_RATE,
    WARNING_FAILURE_RATE,
    build_pareto_summary,
    pick_best_variant,
    score_prompt_variant,
)
from manifest import build_manifest
from metadata import golden_dataset_meta, records_fingerprint, run_metadata
from metrics import pareto_frontier
from rate_limiter import RateLimiter
from rerank_client import RerankClient
from status import save_status, update_run_status


def parse_gcs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith("gs://"):
        raise ValueError(f"Expected gs:// URI, got: {uri}")
    parsed = urlparse(uri)
    return parsed.netloc, parsed.path.lstrip("/")


def gcs_client():
    from google.cloud import storage

    return storage.Client()


def download_gcs_text(uri: str) -> str:
    bucket_name, blob_name = parse_gcs_uri(uri)
    client = gcs_client()
    return client.bucket(bucket_name).blob(blob_name).download_as_text(encoding="utf-8")


def upload_gcs_text(uri: str, content: str, content_type: str = "text/plain") -> None:
    bucket_name, blob_name = parse_gcs_uri(uri)
    client = gcs_client()
    client.bucket(bucket_name).blob(blob_name).upload_from_string(
        content, content_type=content_type
    )


def load_records(input_path: str) -> tuple[list[dict[str, Any]], str | None]:
    raw_text: str | None = None
    if input_path.startswith("gs://"):
        print(f"Downloading dataset from GCS: {input_path}")
        raw_text = download_gcs_text(input_path)
        lines = [line for line in raw_text.splitlines() if line.strip()]
    elif os.path.exists(input_path):
        with open(input_path, encoding="utf-8") as handle:
            raw_text = handle.read()
        lines = [line for line in raw_text.splitlines() if line.strip()]
    else:
        raise FileNotFoundError(f"Input dataset not found: {input_path}")

    records = [json.loads(line) for line in lines]
    print(f"Loaded {len(records)} records from dataset.")
    return records, raw_text


def variant_summary_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k != "per_query"}


def write_outputs(
    output_path: str,
    best_prompt: str,
    variant_results: list[dict[str, Any]],
    best: dict[str, Any],
    args: argparse.Namespace,
    records_count: int,
    golden_meta: dict[str, Any],
    run_meta: dict[str, Any],
    evaluation_time_s: float,
    total_cost_usd: float,
    manifest: dict[str, Any],
) -> dict[str, str]:
    frontier = pareto_frontier(variant_results)
    all_per_query: list[dict[str, Any]] = []
    for variant in variant_results:
        all_per_query.extend(variant.get("per_query") or [])

    summary = {
        "results_schema_version": RESULTS_SCHEMA_VERSION,
        "metadata": run_meta,
        "manifest": manifest,
        "golden_dataset": golden_meta,
        "summary": {
            "winner": best.get("variant_id"),
            "winner_selection": "pareto_under_budget",
            "pareto_frontier": frontier,
            "evaluation_time_s": round(evaluation_time_s, 2),
            "total_cost_usd": round(total_cost_usd, 6),
            "records_evaluated": records_count,
            "variants_evaluated": len(variant_results),
            "degraded": any(v.get("degraded") for v in variant_results),
        },
        "variants": [variant_summary_row(r) for r in variant_results],
        "pareto_frontier": build_pareto_summary(variant_results),
    }

    full = {
        "results_schema_version": RESULTS_SCHEMA_VERSION,
        "manifest": manifest,
        "per_query": all_per_query,
        "variants": variant_results,
    }

    prompt_header = (
        f"# prompt_version={manifest.get('prompt_version')} "
        f"variant={best.get('variant_id')} hash={best.get('prompt_hash')} "
        f"git={manifest.get('git_commit')}\n"
    )
    prompt_body = prompt_header + best_prompt

    files = {
        "best_prompt.txt": prompt_body,
        "results_summary.json": json.dumps(summary, indent=2, ensure_ascii=False),
        "results_full.json": json.dumps(full, indent=2, ensure_ascii=False),
        "manifest.json": json.dumps(manifest, indent=2, ensure_ascii=False),
        "results.json": json.dumps(summary, indent=2, ensure_ascii=False),
    }

    if output_path.startswith("gs://"):
        base = output_path.rstrip("/")
        written: dict[str, str] = {}
        for name, content in files.items():
            uri = f"{base}/{name}"
            ctype = "application/json" if name.endswith(".json") else "text/plain"
            print(f"Uploading {name} -> {uri}")
            upload_gcs_text(uri, content, content_type=ctype)
            written[name] = uri
        return written

    os.makedirs(output_path, exist_ok=True)
    written = {}
    for name, content in files.items():
        path = os.path.join(output_path, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        written[name] = path
    return written


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Vertex AI Prompt Optimizer (production eval)"
    )
    parser.add_argument("--input_data_path", required=True)
    parser.add_argument("--output_data_path", required=True)
    parser.add_argument("--target_model", default="gemini-1.5-flash")
    parser.add_argument("--optimization_metric", default="pareto_ndcg")
    parser.add_argument("--instruction_template", default="")
    parser.add_argument("--max_iterations", type=int, default=4)
    parser.add_argument("--max_records", type=int, default=0)
    parser.add_argument("--cache_path", default="", help="SQLite cache path for resume")
    parser.add_argument(
        "--eval-mode",
        choices=("sync", "async"),
        default="",
        help="sync or async evaluation",
    )
    parser.add_argument(
        "--ci-mode", action="store_true", help="Run CI validation after evaluation"
    )
    args = parser.parse_args()

    reset_config_cache()
    if args.cache_path:
        os.environ["RERANK_CACHE_PATH"] = args.cache_path
    if args.eval_mode:
        os.environ["EVAL_MODE"] = args.eval_mode
    if not args.output_data_path.startswith("gs://"):
        os.environ.setdefault("OUT_DIR", args.output_data_path)
        os.environ.setdefault(
            "STATUS_FILE", os.path.join(args.output_data_path, "status.json")
        )

    cfg = get_config()
    cfg.apply_to_environ()

    max_cost = cfg.max_est_cost_usd
    seed = cfg.seed
    eval_mode = cfg.eval_mode

    print("--- Prompt Optimizer (production rerank evaluation) ---")
    print(
        f"Model: {args.target_model} | Variants: {args.max_iterations} | Mode: {eval_mode}"
    )
    print(
        f"Results schema v{cfg.results_schema_version} | Cache schema v{cfg.cache_schema_version}"
    )
    print(f"Input: {args.input_data_path}")
    print(f"Output: {args.output_data_path}")
    print(f"Cache: {cfg.cache_path}")

    run_started = time.time()
    save_status(
        {
            "status": "running",
            "processed_queries": 0,
            "remaining_queries": 0,
            "total_queries": 0,
            "current_variant": None,
            "started": run_started,
        }
    )

    t0 = time.perf_counter()
    records, raw_text = load_records(args.input_data_path)
    if args.max_records > 0:
        records = records[: args.max_records]
        print(f"Capped to {len(records)} records.")

    golden_meta = golden_dataset_meta(
        path=args.input_data_path, records=records, raw_text=raw_text
    )
    golden_meta["candidate_fingerprint"] = records_fingerprint(records)
    if cfg.golden_version:
        golden_meta["version"] = cfg.golden_version

    cache = PersistentCache(db_path=cfg.cache_path)
    if eval_mode == "async" and os.environ.get("LEGAL_RERANK_EVAL_URL"):
        from async_rerank_client import AsyncRerankClient

        client = AsyncRerankClient(persistent_cache=cache)
        limiter = None
    else:
        client = RerankClient(model=args.target_model, persistent_cache=cache)
        limiter = RateLimiter()
    print(
        f'Eval mode: {eval_mode} | Rerank: {getattr(client, "mode", "async")} | version: {client.reranker_version}'
    )

    run_meta = run_metadata(
        seed=seed,
        target_model=args.target_model,
        reranker_version=client.reranker_version,
        engine=getattr(client, "mode", eval_mode),
        golden_meta=golden_meta,
    )
    run_meta["results_schema_version"] = cfg.results_schema_version
    run_meta["cache_schema_version"] = cfg.cache_schema_version

    update_run_status(
        status="running",
        current_variant="pending",
        processed_queries=0,
        total_queries=len(records) * args.max_iterations,
        started=run_started,
    )

    variant_results: list[dict[str, Any]] = []
    variants = build_variants(args.instruction_template, args.max_iterations)

    for variant_id, template in variants:
        print(f"\n=== Variant {variant_id} ===")
        cached_n = cache.count_variant(variant_id)
        if cached_n:
            print(f"  Resume: {cached_n} cached queries for this variant")

        result = score_prompt_variant(
            records,
            template,
            variant_id=variant_id,
            client=client,
            max_cost_usd=max_cost,
            rate_limiter=limiter,
            eval_mode=eval_mode,
        )
        variant_results.append(result)

        update_run_status(
            status="running",
            current_variant=variant_id,
            processed_queries=result.get("n_evaluated", 0),
            total_queries=len(records),
            started=run_started,
            extra={
                "variants_done": len(variant_results),
                "degraded": result.get("degraded", False),
            },
        )

        ci = result.get("confidence_intervals", {}).get("ndcg10") or result.get(
            "confidence_intervals", {}
        ).get(f"ndcg{cfg.eval_ndcg_k}")
        ci_str = (
            f"{ci['mean']:.3f}+/-{(ci['upper']-ci['lower'])/2:.3f}" if ci else "n/a"
        )
        print(
            f"  ndcg={result['mean_ndcg']:.4f} ({ci_str}) "
            f"spearman={result['mean_spearman']:.4f} "
            f"kendall={result.get('mean_kendall_tau', 0):.4f} "
            f"p95={result['p95_latency_s']:.3f}s "
            f"cost=${result['est_cost_usd']:.4f} "
            f"fail={result['failure_rate']:.2%} "
            f"resumed={result.get('n_resumed_from_cache', 0)}"
        )

        if result.get("aborted_cost_limit"):
            print("  ABORT: cost limit exceeded.")
            break
        if result.get("aborted_failure_budget"):
            print(f"  ABORT: failure rate > {HARD_FAILURE_RATE:.0%}.")
            break
        if result.get("degraded"):
            print(
                f"  WARNING: failure rate > {WARNING_FAILURE_RATE:.0%} (degraded run)."
            )

    best = pick_best_variant(variant_results)
    best_prompt = next(t for vid, t in variants if vid == best["variant_id"])
    total_cost = sum(r.get("est_cost_usd", 0) for r in variant_results)
    eval_time = time.perf_counter() - t0
    manifest = build_manifest(
        cfg=cfg,
        golden_meta=golden_meta,
        best=best,
        reranker_version=client.reranker_version,
        engine=getattr(client, "mode", eval_mode),
    )

    print(
        f"\nWinner: {best['variant_id']} (ndcg={best['mean_ndcg']:.4f}, pareto frontier)"
    )
    written = write_outputs(
        args.output_data_path,
        best_prompt,
        variant_results,
        best,
        args,
        len(records),
        golden_meta,
        run_meta,
        eval_time,
        total_cost,
        manifest,
    )
    save_status(
        {
            "status": "completed",
            "processed_queries": len(records) * len(variant_results),
            "remaining_queries": 0,
            "total_queries": len(records) * args.max_iterations,
            "current_variant": best["variant_id"],
            "winner": best["variant_id"],
            "started": run_started,
            "evaluation_time_s": round(eval_time, 2),
        }
    )
    for name, path in written.items():
        print(f"{name} -> {path}")

    if args.ci_mode:
        summary_path = written.get("results_summary.json") or written.get(
            "results.json"
        )
        if summary_path and not summary_path.startswith("gs://"):
            import subprocess

            repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            script = os.path.join(repo_root, "scripts", "ci_validate_results.py")
            baseline = os.environ.get("CI_BASELINE_JSON", "")
            cmd = [sys.executable, script, summary_path]
            if baseline:
                cmd.extend(["--baseline", baseline])
            print("Running CI validation...")
            subprocess.check_call(cmd)

    return 0


if __name__ == "__main__":
    sys.exit(main())
