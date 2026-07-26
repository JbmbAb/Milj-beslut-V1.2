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

from cache import PersistentCache
from eval import build_pareto_summary, pick_best_variant, score_prompt_variant
from metadata import golden_dataset_meta, records_fingerprint, run_metadata
from metrics import pareto_frontier
from rate_limiter import RateLimiter
from rerank_client import DEFAULT_TEMPLATE, RerankClient


def parse_gcs_uri(uri: str) -> tuple[str, str]:
    if not uri.startswith('gs://'):
        raise ValueError(f'Expected gs:// URI, got: {uri}')
    parsed = urlparse(uri)
    return parsed.netloc, parsed.path.lstrip('/')


def gcs_client():
    from google.cloud import storage

    return storage.Client()


def download_gcs_text(uri: str) -> str:
    bucket_name, blob_name = parse_gcs_uri(uri)
    client = gcs_client()
    return client.bucket(bucket_name).blob(blob_name).download_as_text(encoding='utf-8')


def upload_gcs_text(uri: str, content: str, content_type: str = 'text/plain') -> None:
    bucket_name, blob_name = parse_gcs_uri(uri)
    client = gcs_client()
    client.bucket(bucket_name).blob(blob_name).upload_from_string(content, content_type=content_type)


def load_records(input_path: str) -> tuple[list[dict[str, Any]], str | None]:
    raw_text: str | None = None
    if input_path.startswith('gs://'):
        print(f'Downloading dataset from GCS: {input_path}')
        raw_text = download_gcs_text(input_path)
        lines = [line for line in raw_text.splitlines() if line.strip()]
    elif os.path.exists(input_path):
        with open(input_path, encoding='utf-8') as handle:
            raw_text = handle.read()
        lines = [line for line in raw_text.splitlines() if line.strip()]
    else:
        raise FileNotFoundError(f'Input dataset not found: {input_path}')

    records = [json.loads(line) for line in lines]
    print(f'Loaded {len(records)} records from dataset.')
    return records, raw_text


def variant_summary_row(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k != 'per_query'}


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
) -> tuple[str, str]:
    frontier = pareto_frontier(variant_results)
    payload = {
        'metadata': run_meta,
        'golden_dataset': golden_meta,
        'summary': {
            'winner': best.get('variant_id'),
            'winner_selection': 'pareto_under_latency_budget',
            'pareto_frontier': frontier,
            'evaluation_time_s': round(evaluation_time_s, 2),
            'total_cost_usd': round(total_cost_usd, 6),
            'records_evaluated': records_count,
            'variants_evaluated': len(variant_results),
        },
        'variants': [variant_summary_row(r) for r in variant_results],
        'pareto_frontier': build_pareto_summary(variant_results),
        'best_prompt_hash': best.get('prompt_hash'),
        'best_per_query_sample': (best.get('per_query') or [])[:50],
    }

    if output_path.startswith('gs://'):
        base = output_path.rstrip('/')
        prompt_uri = f'{base}/best_prompt.txt'
        results_uri = f'{base}/results.json'
        print(f'Uploading best prompt to: {prompt_uri}')
        upload_gcs_text(prompt_uri, best_prompt)
        print(f'Uploading results to: {results_uri}')
        upload_gcs_text(results_uri, json.dumps(payload, indent=2, ensure_ascii=False), content_type='application/json')
        return prompt_uri, results_uri

    os.makedirs(output_path, exist_ok=True)
    prompt_file = os.path.join(output_path, 'best_prompt.txt')
    results_file = os.path.join(output_path, 'results.json')
    with open(prompt_file, 'w', encoding='utf-8') as handle:
        handle.write(best_prompt)
    with open(results_file, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    return prompt_file, results_file


def build_variants(base_template: str, max_iterations: int) -> list[tuple[str, str]]:
    seeds = [
        base_template or DEFAULT_TEMPLATE,
        (
            'Du är en svensk miljöexpert. Rangordna dokumenten strikt baserat på '
            'geografisk närhet, juridisk relevans och miljörelevans för frågan: "{{QUERY}}".\n'
            'Returnera JSON-array [{"id":"...","score":0.0-1.0}].\n\nDokumentavsnitt:\n{{DOCUMENTS}}'
        ),
        (
            'System: Rangordna följande svenska miljö- och geodatakontext. '
            'Prioritera direkta träffar mot sökfrågan: "{{QUERY}}".\n'
            'JSON-format: [{"id":"...","score":0.95}]\n\n{{DOCUMENTS}}'
        ),
        (
            'Rank the following Swedish environmental geodata contexts for query "{{QUERY}}". '
            'Prioritize direct feature matches, legal references, and proximity.\n'
            'Output JSON only.\n\n{{DOCUMENTS}}'
        ),
    ]
    return [(f'v{i + 1}', seeds[i % len(seeds)]) for i in range(max_iterations)]


def main() -> int:
    parser = argparse.ArgumentParser(description='Vertex AI Prompt Optimizer (production eval)')
    parser.add_argument('--input_data_path', required=True)
    parser.add_argument('--output_data_path', required=True)
    parser.add_argument('--target_model', default='gemini-1.5-flash')
    parser.add_argument('--optimization_metric', default='pareto_ndcg')
    parser.add_argument('--instruction_template', default='')
    parser.add_argument('--max_iterations', type=int, default=4)
    parser.add_argument('--max_records', type=int, default=0)
    parser.add_argument('--cache_path', default='', help='SQLite cache path for resume')
    args = parser.parse_args()

    if args.cache_path:
        os.environ['RERANK_CACHE_PATH'] = args.cache_path

    max_cost = float(os.environ.get('MAX_EST_COST_USD', '0') or '0') or None
    seed = int(os.environ.get('EVAL_SEED', '42'))

    print('--- Prompt Optimizer (production rerank evaluation) ---')
    print(f'Model: {args.target_model} | Variants: {args.max_iterations}')
    print(f'Input: {args.input_data_path}')
    print(f'Output: {args.output_data_path}')
    print(f'Cache: {os.environ.get("RERANK_CACHE_PATH", ".rerank_eval_cache.sqlite")}')

    t0 = time.perf_counter()
    records, raw_text = load_records(args.input_data_path)
    if args.max_records > 0:
        records = records[: args.max_records]
        print(f'Capped to {len(records)} records.')

    golden_meta = golden_dataset_meta(path=args.input_data_path, records=records, raw_text=raw_text)
    golden_meta['candidate_fingerprint'] = records_fingerprint(records)

    cache = PersistentCache()
    client = RerankClient(model=args.target_model, persistent_cache=cache)
    limiter = RateLimiter()
    print(f'Rerank mode: {client.mode} | version: {client.reranker_version}')

    run_meta = run_metadata(
        seed=seed,
        target_model=args.target_model,
        reranker_version=client.reranker_version,
        engine=client.mode,
        golden_meta=golden_meta,
    )

    variant_results: list[dict[str, Any]] = []
    variants = build_variants(args.instruction_template, args.max_iterations)

    for variant_id, template in variants:
        print(f'\n=== Variant {variant_id} ===')
        cached_n = cache.count_variant(variant_id)
        if cached_n:
            print(f'  Resume: {cached_n} cached queries for this variant')

        result = score_prompt_variant(
            records,
            template,
            variant_id=variant_id,
            client=client,
            max_cost_usd=max_cost,
            rate_limiter=limiter,
        )
        variant_results.append(result)

        ci = result.get('confidence_intervals', {}).get('ndcg10') or result.get('confidence_intervals', {}).get(
            f"ndcg{os.environ.get('EVAL_NDCG_K', '10')}"
        )
        ci_str = f"{ci['mean']:.3f}+/-{(ci['upper']-ci['lower'])/2:.3f}" if ci else 'n/a'
        print(
            f"  ndcg={result['mean_ndcg']:.4f} ({ci_str}) "
            f"spearman={result['mean_spearman']:.4f} "
            f"kendall={result.get('mean_kendall_tau', 0):.4f} "
            f"p95={result['p95_latency_s']:.3f}s "
            f"cost=${result['est_cost_usd']:.4f} "
            f"fail={result['failure_rate']:.2%} "
            f"resumed={result.get('n_resumed_from_cache', 0)}"
        )

        if result.get('aborted_cost_limit'):
            print('  ABORT: cost limit exceeded.')
            break
        if result.get('aborted_failure_budget'):
            print(f'  ABORT: failure rate > {float(os.environ.get("MAX_FAILURE_RATE", "0.02")):.0%}.')
            break

    best = pick_best_variant(variant_results)
    best_prompt = next(t for vid, t in variants if vid == best['variant_id'])
    total_cost = sum(r.get('est_cost_usd', 0) for r in variant_results)
    eval_time = time.perf_counter() - t0

    print(f"\nWinner: {best['variant_id']} (ndcg={best['mean_ndcg']:.4f}, pareto frontier)")
    prompt_dest, results_dest = write_outputs(
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
    )
    print(f'best_prompt.txt -> {prompt_dest}')
    print(f'results.json -> {results_dest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
