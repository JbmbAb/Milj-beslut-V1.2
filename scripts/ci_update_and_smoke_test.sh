#!/bin/bash
# scripts/ci_update_and_smoke_test.sh
# Pull optimized prompt, update POC pipeline, run fixture eval + POC smoke.
# Auto-commit disabled — human review required before merging prompt changes.

set -e

PROMPT_GCS_URI=${1:-"gs://miljobeslut-prompt-optimization-bucket/alphaevolve/list_deduplication/prompt_opt_results/best_prompt.txt"}
PIPELINE_FILE="poc_end_to_end.py"

echo "=========================================================="
echo " Automated Pipeline Update & Verification"
echo " Target GCS URI: $PROMPT_GCS_URI"
echo "=========================================================="

echo "[Step 1] Fetching optimized prompt and updating pipeline..."
python scripts/update_pipeline_prompt.py \
    --pipeline "$PIPELINE_FILE" \
    --node_id n2_i \
    --prompt_gcs "$PROMPT_GCS_URI"

echo "[Step 2] Legal rerank fixture eval (thresholds)..."
npx tsx scripts/eval/run_legal_rerank_eval.ts

echo "[Step 3] POC Monte Carlo smoke test..."
if command -v uv &> /dev/null; then
    uv run --with networkx --with numpy --with scipy --with pyyaml \
        python "$PIPELINE_FILE" --smoke --use_prompt "$PROMPT_GCS_URI"
else
    python "$PIPELINE_FILE" --smoke --use_prompt "$PROMPT_GCS_URI"
fi

echo "[Step 4] list_deduplication regression tests..."
if [ -f "alphaevolve-on-googlecloud/.venv/Scripts/python.exe" ]; then
    alphaevolve-on-googlecloud/.venv/Scripts/python.exe -m pytest \
        alphaevolve-on-googlecloud/examples/list_deduplication/tests -q
elif [ -f "alphaevolve-on-googlecloud/.venv/bin/python" ]; then
    alphaevolve-on-googlecloud/.venv/bin/python -m pytest \
        alphaevolve-on-googlecloud/examples/list_deduplication/tests -q
else
    echo "Skip: alphaevolve venv not found (optional regression suite)."
fi

if [ -d .git ] && ! git diff --quiet "$PIPELINE_FILE"; then
    echo "[Note] $PIPELINE_FILE changed — review locally. Auto-commit is disabled."
    git diff --stat "$PIPELINE_FILE" || true
fi

echo "=========================================================="
echo " Verification completed successfully (no auto-commit)."
echo "=========================================================="
