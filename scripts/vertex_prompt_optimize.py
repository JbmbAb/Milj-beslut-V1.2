#!/usr/bin/env python3
"""Launch Vertex AI Custom Job for prompt optimizer container evaluation.

Command-line arguments:
    --project: Google Cloud project ID.
    --bucket: GCS bucket URI (``gs://your-bucket/...``).
    --container: Custom container image (``gcr.io/...``).
    --location: GCP region (default ``us-central1``).
"""

import argparse
from google.cloud import aiplatform


def launch_prompt_optimization_job(project_id, bucket_uri, container_image, location):
    """Create and run a Vertex Custom Job pointing at the prompt optimizer image."""
    print(
        f"Initializing Vertex AI SDK on project '{project_id}' in region '{location}'..."
    )
    aiplatform.init(project=project_id, location=location)

    # Clean bucket URI if it includes gs://
    bucket_name = bucket_uri.replace("gs://", "").split("/")[0]

    # Input/Output paths
    input_path = f"gs://{bucket_name}/alphaevolve/list_deduplication/golden_v1/golden_v1_2000_records.jsonl"
    output_path = (
        f"gs://{bucket_name}/alphaevolve/list_deduplication/prompt_opt_results"
    )

    print(f"Uploading config metadata...")
    print(f" GCS Input:  {input_path}")
    print(f" GCS Output: {output_path}")

    # Worker pool specifications with n1-standard-4
    worker_pool_specs = [
        {
            "machine_spec": {
                "machine_type": "n1-standard-4",
            },
            "replica_count": 1,
            "container_spec": {
                "image_uri": container_image,
                "args": [
                    f"--input_data_path={input_path}",
                    f"--output_data_path={output_path}",
                    "--target_model=gemini-1.5-flash",
                    "--optimization_metric=ranking_accuracy",
                    "--instruction_template=You are an expert Swedish environmental geodata reranker. Given a user query and a set of spatial/semantic documents, rank them in order of relevance.",
                    "--max_iterations=10",
                ],
            },
        }
    ]

    print("Creating Vertex AI Custom Job...")
    custom_job = aiplatform.CustomJob(
        display_name="alphaevolve-prompt-optimization",
        worker_pool_specs=worker_pool_specs,
        staging_bucket=f"gs://{bucket_name}/staging",
    )

    print("Launching job in Vertex AI... (monitoring enabled)")
    custom_job.run(sync=True)
    print("Job completed successfully!")


def main():
    parser = argparse.ArgumentParser(
        description="Launch Prompt Optimization on Vertex AI"
    )
    parser.add_argument("--project", required=True, help="GCP Project ID")
    parser.add_argument(
        "--bucket", required=True, help="GCS Bucket Name or URI (e.g. gs://bucket)"
    )
    parser.add_argument(
        "--container", required=True, help="Container image URI (e.g. gcr.io/...)"
    )
    parser.add_argument("--location", default="us-central1", help="GCP Region")
    args = parser.parse_args()

    launch_prompt_optimization_job(
        project_id=args.project,
        bucket_uri=args.bucket,
        container_image=args.container,
        location=args.location,
    )


if __name__ == "__main__":
    main()
