"""Reproducibility metadata for prompt optimization runs."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
import time
from typing import Any

from config import get_config


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def golden_dataset_meta(
    *,
    path: str,
    records: list[dict[str, Any]],
    raw_text: str | None = None,
) -> dict[str, Any]:
    content_hash = sha256_text(raw_text) if raw_text else None
    if content_hash is None and os.path.isfile(path):
        content_hash = sha256_file(path)

    version = get_config().golden_version or os.environ.get(
        "GOLDEN_DATASET_VERSION", "v1"
    )
    split = get_config().golden_split
    created = get_config().golden_created or os.environ.get(
        "GOLDEN_DATASET_CREATED", ""
    )

    return {
        "version": version,
        "sha256": content_hash or "unknown",
        "path": path,
        "n_queries": len(records),
        "created": created or None,
        "split": split,
    }


def run_metadata(
    *,
    seed: int,
    target_model: str,
    reranker_version: str,
    engine: str,
    golden_meta: dict[str, Any],
) -> dict[str, Any]:
    cfg = get_config()
    return {
        "python_version": platform.python_version(),
        "platform": platform.platform(),
        "prompt_version": cfg.prompt_version,
        "git_commit": cfg.git_commit
        or os.environ.get("GIT_COMMIT", os.environ.get("SHORT_SHA", "unknown")),
        "container_digest": cfg.container_digest
        or cfg.image_uri
        or os.environ.get("CONTAINER_DIGEST", "unknown"),
        "seed": seed,
        "target_model": target_model,
        "reranker_version": reranker_version,
        "engine": engine,
        "golden_dataset": golden_meta,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "eval_ndcg_k": cfg.eval_ndcg_k,
        "max_concurrent_queries": cfg.max_workers,
        "max_requests_per_minute": cfg.requests_per_min,
        "max_tokens_per_minute": cfg.tokens_per_min,
        "cache_path": cfg.cache_path,
        "results_schema_version": cfg.results_schema_version,
        "cache_schema_version": cfg.cache_schema_version,
    }


def records_fingerprint(records: list[dict[str, Any]]) -> str:
    payload = [
        {
            "id": r.get("id") or r.get("query_id"),
            "gold": r.get("gold_ranking"),
            "candidates": sorted(
                str(d.get("doc_id") or d.get("id", ""))
                for d in (r.get("context_documents") or r.get("candidates") or [])
            ),
        }
        for r in records
    ]
    return sha256_text(json.dumps(payload, sort_keys=True))
