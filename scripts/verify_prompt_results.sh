#!/usr/bin/env bash
# scripts/verify_prompt_results.sh
# Load results.json from GCS or local path and enforce quality gates for CI.
set -euo pipefail

RESULTS_URI="${1:-}"
PRODUCTION_NDCG="${PRODUCTION_NDCG:-0.65}"
PRODUCTION_LATENCY_P95="${PRODUCTION_LATENCY_P95:-3.0}"
NDCG_REGRESSION_TOLERANCE="${NDCG_REGRESSION_TOLERANCE:-0.02}"
LATENCY_REGRESSION_TOLERANCE="${LATENCY_REGRESSION_TOLERANCE:-0.20}"
MAX_FAILURE_RATE="${MAX_FAILURE_RATE:-0.02}"

if [[ -z "$RESULTS_URI" ]]; then
  echo "Usage: verify_prompt_results.sh <local-path-or-gs://.../results.json>"
  exit 1
fi

TMP="$(mktemp)"
cleanup() { rm -f "$TMP"; }
trap cleanup EXIT

if [[ "$RESULTS_URI" == gs://* ]]; then
  gsutil cp "$RESULTS_URI" "$TMP"
else
  cp "$RESULTS_URI" "$TMP"
fi

python3 - <<'PY' "$TMP" "$PRODUCTION_NDCG" "$PRODUCTION_LATENCY_P95" \
  "$NDCG_REGRESSION_TOLERANCE" "$LATENCY_REGRESSION_TOLERANCE" "$MAX_FAILURE_RATE"
import json, sys

path, prod_ndcg, prod_lat, ndcg_tol, lat_tol, max_fail = sys.argv[1:7]
prod_ndcg = float(prod_ndcg)
prod_lat = float(prod_lat)
ndcg_tol = float(ndcg_tol)
lat_tol = float(lat_tol)
max_fail = float(max_fail)

with open(path, encoding='utf-8') as f:
    data = json.load(f)

winner_id = data.get('summary', {}).get('winner') or data.get('best_variant_id')
variants = data.get('variants') or []
winner = next((v for v in variants if v.get('variant_id') == winner_id), variants[0] if variants else {})

mean_ndcg = float(winner.get('mean_ndcg') or winner.get('mean_ndcg10') or 0)
p95 = float(winner.get('p95_latency_s') or 0)
fail_rate = float(winner.get('failure_rate') or 0)

print(f"Winner: {winner_id}")
print(f"  mean_ndcg={mean_ndcg:.4f} (production baseline {prod_ndcg})")
print(f"  p95_latency_s={p95:.3f} (production baseline {prod_lat}s)")
print(f"  failure_rate={fail_rate:.2%}")

errors = []
if mean_ndcg < prod_ndcg - ndcg_tol:
    errors.append(f"ndcg regression: {mean_ndcg:.4f} < {prod_ndcg - ndcg_tol:.4f}")
if p95 > prod_lat * (1 + lat_tol):
    errors.append(f"latency regression: {p95:.3f}s > {prod_lat * (1 + lat_tol):.3f}s")
if fail_rate > max_fail:
    errors.append(f"failure rate too high: {fail_rate:.2%} > {max_fail:.0%}")

ci = (winner.get('confidence_intervals') or {}).get('ndcg10') or {}
if ci:
    print(f"  ndcg CI: {ci.get('mean')} [{ci.get('lower')}, {ci.get('upper')}]")

if errors:
    print("QUALITY GATE FAILED:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)

print("Quality gates passed.")
PY

echo "verify_prompt_results.sh OK"
