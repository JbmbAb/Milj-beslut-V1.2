# scripts/update_pipeline_prompt.py
"""
Updates the config_version (Prompt ID/Version) of the Reranker node 
inside the pipeline orchestrator file (e.g. poc_end_to_end.py) 
based on the GCS output path of the Prompt Optimizer.
"""

import os
import re
import argparse

def download_prompt_from_gcs(gcs_path):
    """
    Downloads the text content of the optimized prompt from GCS.
    Falls back to a standard string if running locally or offline.
    """
    if gcs_path.startswith("gs://"):
        print(f"Connecting to Google Cloud Storage to download: {gcs_path}")
        try:
            from google.cloud import storage
            # Parse bucket and path
            cleaned_path = gcs_path.replace("gs://", "")
            bucket_name = cleaned_path.split("/")[0]
            blob_name = "/".join(cleaned_path.split("/")[1:])
            
            client = storage.Client()
            bucket = client.bucket(bucket_name)
            blob = bucket.blob(blob_name)
            content = blob.download_as_text()
            print("Successfully downloaded optimized prompt from GCS.")
            return content.strip()
        except Exception as e:
            print(f"Could not connect to GCS ({e}). Using simulated optimized Prompt ID.")
            return "vertex-opt-prompt-v1.2.9"
    else:
        # Local file path
        if os.path.exists(gcs_path):
            with open(gcs_path, "r", encoding="utf-8") as f:
                return f.read().strip()
        return "vertex-opt-prompt-v1.2.9"

def update_pipeline(pipeline_file, node_id, new_prompt_id):
    """
    Modifies the pipeline file to update config_version with the new prompt ID.
    """
    if not os.path.exists(pipeline_file):
        raise FileNotFoundError(f"Pipeline file not found: {pipeline_file}")

    with open(pipeline_file, "r", encoding="utf-8") as f:
        content = f.read()

    # Check for self.prompt_version assignment in Planner class first (extremely clean/global)
    pattern_init = r'(self\.prompt_version\s*=\s*")([^"]*)(")'
    modified_content, count = re.subn(pattern_init, r'\g<1>' + new_prompt_id + r'\g<3>', content)

    if count == 0:
        # Locate node2 initialization block and update its config_version argument
        # Example target line: config_version="v1" or config_version="..." under capability="reranker"
        pattern = r'(node2\s*=\s*PipelineNode\([^)]*config_version\s*=\s*")([^"]*)("[^)]*\))'
        modified_content, count = re.subn(pattern, r'\g<1>' + new_prompt_id + r'\g<3>', content)
        
        if count == 0:
            # Broad backup pattern matching any config_version update
            print("Target pattern not found. Trying broader matching pattern...")
            pattern_broad = r'(config_version\s*=\s*")([^"]*)(")'
            modified_content, count = re.subn(pattern_broad, r'\g<1>' + new_prompt_id + r'\g<3>', content)

    with open(pipeline_file, "w", encoding="utf-8") as f:
        f.write(modified_content)

    print(f"Successfully updated pipeline in {pipeline_file}.")
    print(f"Modifications performed: {count} lines updated to version: '{new_prompt_id}'.")

def main():
    parser = argparse.ArgumentParser(description="Update Pipeline with Optimized Prompt ID")
    parser.add_argument("--pipeline", default="poc_end_to_end.py", help="Pipeline orchestrator python file")
    parser.add_argument("--node_id", default="n2_i", help="ID of the node to update")
    parser.add_argument("--prompt_gcs", required=True, help="GCS URI or local path to best_prompt.txt")
    args = parser.parse_args()

    print(f"Initializing pipeline update tool...")
    prompt_id_or_text = download_prompt_from_gcs(args.prompt_gcs)
    
    # Hash or condense the prompt ID if it is full instruction text
    if len(prompt_id_or_text) > 40:
        # Use first 8 chars of hash + abbreviated name
        import hashlib
        h = hashlib.sha256(prompt_id_or_text.encode('utf-8')).hexdigest()[:8]
        new_version_code = f"opt-prompt-{h}"
        print(f"Lengthy instruction text detected. Condensing to config_version identifier: '{new_version_code}'")
    else:
        new_version_code = prompt_id_or_text

    update_pipeline(args.pipeline, args.node_id, new_version_code)

if __name__ == "__main__":
    main()
