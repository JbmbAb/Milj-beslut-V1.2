#!/usr/bin/env python3
"""CI quality gates for prompt optimizer results (conservative CI-based checks)."""

from __future__ import annotations

import argparse
import json
import os
import sys


def load_json(path: str) -> dict:
    with open(path, encoding='utf-8') as handle:
        return json.load(handle)


def find_winner(data: dict) -> dict:
    winner_id = data.get('summary', {}).get('winner') or data.get('best_variant_id')
    variants = data.get('variants') or []
    for variant in variants:
        if variant.get('variant_id') == winner_id:
            return variant
    return variants[0] if variants else {}


def validate(
    results_path: str,
    *,
    baseline_path: str | None = None,
    ndcg_tolerance: float | None = None,
    latency_tolerance: float | None = None,
    hard_failure_rate: float | None = None,
) -> list[str]:
    data = load_json(results_path)
    winner = find_winner(data)
    if not winner:
        return ['no variants in results']

    ndcg_tol = ndcg_tolerance if ndcg_tolerance is not None else float(os.environ.get('NDCG_REGRESSION_TOLERANCE', '0.02'))
    lat_tol = latency_tolerance if latency_tolerance is not None else float(os.environ.get('LATENCY_REGRESSION_TOLERANCE', '0.20'))
    max_fail = hard_failure_rate if hard_failure_rate is not None else float(os.environ.get('HARD_FAILURE_RATE', '0.05'))

    ci = (winner.get('confidence_intervals') or {})
    ndcg_ci = ci.get('ndcg10') or ci.get('ndcg10') or next((v for k, v in ci.items() if k.startswith('ndcg')), {})
    lat_ci = ci.get('p95_latency_s') or {}

    mean_ndcg = float(winner.get('mean_ndcg') or 0)
    ndcg_lower = float(ndcg_ci.get('lower', mean_ndcg))
    p95 = float(winner.get('p95_latency_s') or 0)
    lat_upper = float(lat_ci.get('upper', p95))
    fail_rate = float(winner.get('failure_rate') or 0)

    baseline_ndcg = float(os.environ.get('PRODUCTION_NDCG', '0'))
    baseline_lat = float(os.environ.get('PRODUCTION_LATENCY_P95', '999'))

    if baseline_path:
        baseline = load_json(baseline_path)
        bw = find_winner(baseline)
        baseline_ndcg = float(bw.get('mean_ndcg') or baseline_ndcg)
        baseline_lat = float(bw.get('p95_latency_s') or baseline_lat)

    errors: list[str] = []
    if baseline_ndcg > 0 and ndcg_lower < baseline_ndcg - ndcg_tol:
        errors.append(
            f'ndcg CI lower bound {ndcg_lower:.4f} < baseline {baseline_ndcg:.4f} - {ndcg_tol:.4f}'
        )
    if baseline_lat < 900 and lat_upper > baseline_lat * (1 + lat_tol):
        errors.append(
            f'p95 latency CI upper {lat_upper:.3f}s > baseline {baseline_lat:.3f}s + {lat_tol:.0%}'
        )
    if fail_rate > max_fail:
        errors.append(f'failure_rate {fail_rate:.2%} > hard limit {max_fail:.0%}')

    warn_rate = float(os.environ.get('WARNING_FAILURE_RATE', '0.02'))
    if fail_rate > warn_rate:
        print(f'WARNING: failure_rate {fail_rate:.2%} exceeds warning threshold {warn_rate:.0%}')

    print(f"Winner: {winner.get('variant_id')}")
    print(f'  mean_ndcg={mean_ndcg:.4f} CI=[{ndcg_ci.get("lower")}, {ndcg_ci.get("upper")}]')
    print(f'  p95_latency_s={p95:.3f} CI upper={lat_upper:.3f}')
    print(f'  failure_rate={fail_rate:.2%}')
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description='Validate prompt optimizer CI gates')
    parser.add_argument('results_summary', help='Path to results_summary.json')
    parser.add_argument('--baseline', default='', help='Optional baseline results_summary.json')
    args = parser.parse_args()

    errors = validate(args.results_summary, baseline_path=args.baseline or None)
    if errors:
        print('CI QUALITY GATE FAILED:')
        for err in errors:
            print(f'  - {err}')
        return 1
    print('CI quality gates passed.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
