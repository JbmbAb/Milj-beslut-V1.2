#!/usr/bin/env python3
"""Minimal Vertex AI connectivity check for CI (WIF / ADC)."""

from __future__ import annotations

import os
import sys

PROJECT = os.environ.get("GOOGLE_CLOUD_PROJECT", os.environ.get("VERTEX_PROJECT_ID", "miljointelligens"))
LOCATION = os.environ.get("VERTEX_LOCATION", "europe-west1")


def main() -> int:
    try:
        from google.cloud import aiplatform
    except ImportError:
        print("ERROR: google-cloud-aiplatform not installed", file=sys.stderr)
        return 1

    aiplatform.init(project=PROJECT, location=LOCATION)
    print(f"Vertex AI init OK: project={PROJECT} location={LOCATION}")

    # Lightweight API touch — list endpoint count (no model download).
    from google.cloud.aiplatform_v1.services.model_service import ModelServiceClient
    from google.cloud.aiplatform_v1.types import ListModelsRequest

    client = ModelServiceClient(
        client_options={"api_endpoint": f"{LOCATION}-aiplatform.googleapis.com"}
    )
    parent = f"projects/{PROJECT}/locations/{LOCATION}"
    request = ListModelsRequest(parent=parent, page_size=1)
    page = client.list_models(request=request)
    models = list(page)
    print(f"ListModels OK: sample_count={len(models)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
