"""Reproducibility metadata for prompt optimization runs."""

from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
import time
from typing import Any


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(65536), b''):
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

    version = os.environ.get('GOLDEN_DATASET_VERSION', 'v1')
    split = os.environ.get('GOLDEN_DATASET_SPLIT', 'validation')
    created = os.environ.get('GOLDEN_DATASET_CREATED', '')

    return {
        'version': version,
        'sha256': content_hash or 'unknown',
        'path': path,
        'n_queries': len(records),
        'created': created or None,
        'split': split,
    }


def run_metadata(
    *,
    seed: int,
    target_model: str,
    reranker_version: str,
    engine: str,
    golden_meta: dict[str, Any],
) -> dict[str, Any]:
    return {
        'python_version': platform.python_version(),
        'platform': platform.platform(),
        'prompt_version': os.environ.get('PROMPT_VERSION', '1'),
        'git_commit': os.environ.get('GIT_COMMIT', os.environ.get('SHORT_SHA', 'unknown')),
        'container_digest': os.environ.get('CONTAINER_DIGEST', os.environ.get('IMAGE_URI', 'unknown')),
        'seed': seed,
        'target_model': target_model,
        'reranker_version': reranker_version,
        'engine': engine,
        'golden_dataset': golden_meta,
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'eval_ndcg_k': int(os.environ.get('EVAL_NDCG_K', '10')),
        'max_concurrent_queries': int(os.environ.get('MAX_CONCURRENT_QUERIES', '8')),
        'max_requests_per_minute': int(os.environ.get('MAX_REQUESTS_PER_MINUTE', '120')),
        'max_tokens_per_minute': int(os.environ.get('MAX_TOKENS_PER_MINUTE', '400000')),
        'cache_path': os.environ.get('RERANK_CACHE_PATH', ''),
    }


def records_fingerprint(records: list[dict[str, Any]]) -> str:
    payload = [
        {
            'id': r.get('id') or r.get('query_id'),
            'gold': r.get('gold_ranking'),
            'candidates': sorted(
                str(d.get('doc_id') or d.get('id', ''))
                for d in (r.get('context_documents') or r.get('candidates') or [])
            ),
        }
        for r in records
    ]
    return sha256_text(json.dumps(payload, sort_keys=True))
