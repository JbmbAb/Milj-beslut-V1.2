#!/bin/bash
# gcloud_prompt_optimizer.sh
# Flexible CLI script to submit custom prompt optimization custom jobs to Vertex AI.

# Default values
PROJECT_ID="miljointelligens"
REGION="europe-west1"
BUCKET_NAME="miljobeslut-prompt-optimization-bucket"
RERANKER_IMPL="cross-enc-small"

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --bucket) BUCKET_NAME="$2"; shift ;;
        --reranker_impl) RERANKER_IMPL="$2"; shift ;;
        --project) PROJECT_ID="$2"; shift ;;
        --region) REGION="$2"; shift ;;
        *) echo "Unknown parameter passed: $1"; exit 1 ;;
    esac
    shift
done

# Clean bucket variable if it includes gs://
BUCKET_NAME=$(echo "$BUCKET_NAME" | sed 's|^gs://||')

echo "--------------------------------------------------------"
echo "Project ID:      ${PROJECT_ID}"
echo "Region:          ${REGION}"
echo "GCS Bucket:      gs://${BUCKET_NAME}"
echo "Reranker Impl:   ${RERANKER_IMPL}"
echo "--------------------------------------------------------"

# 1. Generate the job YAML payload
cat <<EOF > prompt_optimizer_job.yaml
displayName: prompt-optimizer-custom-job
jobSpec:
  workerPoolSpecs:
    - machineSpec:
        machineType: n1-standard-4
      replicaCount: 1
      containerSpec:
        imageUri: gcr.io/${PROJECT_ID}/prompt-optimizer:latest
        args:
          - --input_data_path=gs://${BUCKET_NAME}/alphaevolve/list_deduplication/golden_v1/golden_v1_2000_records.jsonl
          - --output_data_path=gs://${BUCKET_NAME}/alphaevolve/list_deduplication/prompt_opt_results
          - --target_model=gemini-1.5-flash
          - --optimization_metric=ranking_accuracy
          - --instruction_template=You are an expert Swedish environmental geodata reranker (${RERANKER_IMPL}). Given a user query and a set of spatial/semantic documents, rank them in order of relevance.
          - --max_iterations=10
  stagingBucket: gs://${BUCKET_NAME}/staging
EOF

echo "Submitting Custom Job to Vertex AI..."

# 2. Submit the custom-job
gcloud ai custom-jobs create \
    --region=${REGION} \
    --project=${PROJECT_ID} \
    --config=prompt_optimizer_job.yaml

echo "Submission completed successfully. Monitor the process in your GCP Console."
