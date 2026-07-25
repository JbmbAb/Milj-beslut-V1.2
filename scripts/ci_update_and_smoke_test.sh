#!/bin/bash
# scripts/ci_update_and_smoke_test.sh
# Automation script for CI/CD runners to pull the latest optimized prompt,
# update the pipeline configuration, and run a validation smoke test.

set -e

# Configurable variables
PROMPT_GCS_URI=${1:-"gs://miljobeslut-prompt-optimization-bucket/alphaevolve/list_deduplication/prompt_opt_results/best_prompt.txt"}
PIPELINE_FILE="poc_end_to_end.py"

echo "=========================================================="
echo " Starting Automated Pipeline Update & Verification"
echo " Target GCS URI: $PROMPT_GCS_URI"
echo "=========================================================="

# 1. Update pipeline config version with the optimized prompt
echo "[Step 1] Fetching optimized prompt and updating pipeline..."
python scripts/update_pipeline_prompt.py \
    --pipeline "$PIPELINE_FILE" \
    --node_id n2_i \
    --prompt_gcs "$PROMPT_GCS_URI"

# 2. Run Smoke test via UV sandbox
echo "[Step 2] Executing pipeline verification smoke test..."
if command -v uv &> /dev/null; then
    uv run --with networkx --with numpy --with scipy --with pyyaml \
        python "$PIPELINE_FILE" --smoke --use_prompt "$PROMPT_GCS_URI"
else
    echo "UV package manager not found. Falling back to standard python execution..."
    python "$PIPELINE_FILE" --smoke --use_prompt "$PROMPT_GCS_URI"
fi

# 3. Check for differences and optionally commit to Git
echo "[Step 3] Checking for modifications..."
if [ -d .git ]; then
    if git diff --quiet "$PIPELINE_FILE"; then
        echo "No changes detected in $PIPELINE_FILE. Pipeline was already up to date."
    else
        echo "Changes detected! Committing updated pipeline to repository..."
        git add "$PIPELINE_FILE"
        git commit -m "chore(pipeline): auto-update reranker prompt to optimized version [skip ci]"
        echo "Success: Local commit created. Push to remote in your deployment step."
    fi
else
    echo "Not a Git repository, skipping automatic commit."
fi

echo "=========================================================="
echo " Automation completed successfully!"
echo "=========================================================="
