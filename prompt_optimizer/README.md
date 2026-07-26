# Prompt Optimizer

Production-grade rerank prompt evaluation against a golden dataset. Replaces heuristic proxy scoring with real rerank calls, persistent cache/resume, Pareto winner selection, and CI quality gates.

## Quick start (local mock)

```bash
cd prompt_optimizer
export MOCK_RERANK=1
python main.py \
  --input_data_path ../benchmarks/golden_v1_2000_records.jsonl \
  --output_data_path ./out \
  --max_iterations 2 \
  --max_records 50 \
  --cache_path ./out/eval_cache.sqlite \
  --eval-mode async \
  --ci-mode
```

## Configuration

Central config lives in `config.py` (Pydantic Settings). Override via environment variables or a `.env` file in the working directory.

| Variable | Default | Description |
|---|---|---|
| `RESULTS_SCHEMA_VERSION` | `1` | Results JSON schema version |
| `CACHE_SCHEMA_VERSION` | `1` | Cache key/value schema version |
| `MAX_CONCURRENT_QUERIES` | `8` | Max concurrent rerank workers |
| `MAX_REQUESTS_PER_MINUTE` | `120` | Rate limit: requests/min |
| `MAX_TOKENS_PER_MINUTE` | `400000` | Rate limit: tokens/min |
| `RERANK_TIMEOUT` | `6.0` | Per-request timeout (seconds) |
| `RERANK_MAX_RETRIES` | `4` | Retry attempts in RerankClient |
| `BOOTSTRAP_SAMPLES` | `1000` | Bootstrap resamples for CI |
| `EVAL_SEED` | `42` | Random seed |
| `WARNING_FAILURE_RATE` | `0.02` | Mark run degraded above this |
| `HARD_FAILURE_RATE` | `0.05` | Abort run above this |
| `CHECKPOINT_INTERVAL` | `50` | Queries between checkpoint writes |
| `RERANK_CACHE_PATH` | `./rerank_eval_cache.sqlite` | Persistent SQLite cache |
| `STATUS_FILE` | `./out/status.json` | Run status / progress |
| `EVAL_MODE` | `sync` | `sync` or `async` |
| `LEGAL_RERANK_EVAL_URL` | — | HTTP rerank endpoint (async mode) |
| `MOCK_RERANK` | — | Set `1` for local mock reranker |

Validation rule: `HARD_FAILURE_RATE` must be >= `WARNING_FAILURE_RATE`.

## Outputs

Written to `--output_data_path` (local dir or GCS prefix):

| File | Purpose |
|---|---|
| `best_prompt.txt` | Winning prompt + metadata header |
| `results_summary.json` | Metadata, variants, Pareto, CI aggregates |
| `results_full.json` | Per-query breakdown + raw rankings |
| `manifest.json` | Reproducibility manifest (git, deps, golden hash) |
| `status.json` | Run progress (`running` / `completed`) |
| `results.json` | Alias of `results_summary.json` (backward compat) |

Optional: `PER_QUERY_LOG_PATH` appends newline-delimited JSON per query.

## Resume / checkpoint

1. **Persistent cache** — rerank results keyed by `sha256(cache_schema|prompt_hash|query_id|candidate_hash|reranker_version)`.
2. **Checkpoint file** — `EVAL_CHECKPOINT_PATH` updated every `CHECKPOINT_INTERVAL` queries.
3. **Status file** — `STATUS_FILE` tracks `processed_queries`, `current_variant`, etc.

Re-run the same command after interruption; cached queries are skipped automatically.

## Staging (HTTP async)

```bash
export EVAL_MODE=async
export LEGAL_RERANK_EVAL_URL=https://staging.example/api/rerank/eval
python main.py \
  --input_data_path gs://bucket/golden_v1.jsonl \
  --output_data_path gs://bucket/prompt_opt_results/run-001 \
  --max_iterations 4
```

## Vertex Custom Job

Container entrypoint: `python main.py` with args passed by `gcloud_prompt_optimizer.sh` or `.github/workflows/vertex_prompt_optimize.yml`.

Set `GIT_COMMIT`, `CONTAINER_DIGEST`, and `IMAGE_URI` in the job env for manifest stamping.

## Tests

```bash
cd prompt_optimizer
python -m unittest discover -s tests -v
```

## CI gates

After evaluation with `--ci-mode`, or manually:

```bash
python scripts/ci_validate_results.py ./out/results_summary.json --baseline ./baseline.json
```

Fails if conservative CI bounds regress vs baseline (nDCG lower bound, latency upper bound, failure rate).
