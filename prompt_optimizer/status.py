"""Run status file — checkpoint metadata for monitoring and resume."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from config import get_config


def status_path() -> Path:
    return Path(os.environ.get("STATUS_FILE", get_config().status_file))


def save_status(status_obj: dict[str, Any], *, path: Path | None = None) -> None:
    """Atomic write of status JSON."""
    dest = path or status_path()
    dest.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(status_obj)
    payload["updated"] = time.time()
    tmp = dest.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    tmp.replace(dest)


def load_status(*, path: Path | None = None) -> dict[str, Any] | None:
    dest = path or status_path()
    if not dest.exists():
        return None
    with dest.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def update_run_status(
    *,
    status: str,
    current_variant: str,
    processed_queries: int,
    total_queries: int,
    started: float | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    existing = load_status() or {}
    payload = {
        "status": status,
        "current_variant": current_variant,
        "processed_queries": processed_queries,
        "remaining_queries": max(total_queries - processed_queries, 0),
        "total_queries": total_queries,
        "started": started or existing.get("started") or time.time(),
        **(extra or {}),
    }
    save_status(payload)
