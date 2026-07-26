"""Manifest builder with runtime and dependency versions."""

from __future__ import annotations

import platform
import subprocess
import sys
import time
from typing import Any

from config import Config, get_config
from constants import CACHE_SCHEMA_VERSION, RESULTS_SCHEMA_VERSION


def git_commit_hash() -> str | None:
    cfg = get_config()
    if cfg.git_commit:
        return cfg.git_commit
    try:
        return subprocess.check_output(['git', 'rev-parse', 'HEAD'], stderr=subprocess.DEVNULL).decode().strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def _optional_pkg_version(module_name: str) -> str | None:
    try:
        mod = __import__(module_name)
        return getattr(mod, '__version__', None)
    except ImportError:
        return None


def build_manifest(
    *,
    cfg: Config | None = None,
    container_digest: str | None = None,
    golden_meta: dict[str, Any] | None = None,
    best: dict[str, Any] | None = None,
    reranker_version: str | None = None,
    engine: str | None = None,
) -> dict[str, Any]:
    """Build reproducibility manifest with schema versions and dependency pins."""
    cfg = cfg or get_config()
    golden = golden_meta or {}
    digest = container_digest or cfg.container_digest or cfg.image_uri or 'unknown'

    return {
        'results_schema_version': cfg.results_schema_version or RESULTS_SCHEMA_VERSION,
        'cache_schema_version': cfg.cache_schema_version or CACHE_SCHEMA_VERSION,
        'prompt_version': cfg.prompt_version,
        'git_commit': git_commit_hash() or 'unknown',
        'container_digest': digest,
        'golden_hash': golden.get('sha256'),
        'golden_dataset': {
            'version': golden.get('version'),
            'sha256': golden.get('sha256'),
            'num_queries': golden.get('n_queries'),
            'candidate_set_hash': golden.get('candidate_fingerprint'),
            'created': golden.get('created'),
            'split': golden.get('split'),
            'path': golden.get('path'),
        },
        'reranker_version': reranker_version or cfg.reranker_version,
        'engine': engine,
        'seed': cfg.seed,
        'python_version': sys.version,
        'python_version_short': platform.python_version(),
        'os': platform.system(),
        'architecture': platform.machine(),
        'platform': platform.platform(),
        'httpx_version': _optional_pkg_version('httpx'),
        'tenacity_version': _optional_pkg_version('tenacity'),
        'diskcache_version': _optional_pkg_version('diskcache'),
        'cache_backend': 'sqlite',
        'winner_variant_id': (best or {}).get('variant_id'),
        'winner_prompt_hash': (best or {}).get('prompt_hash'),
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
    }
