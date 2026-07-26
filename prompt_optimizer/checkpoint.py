"""Progress checkpoint for resume after interrupted optimization runs."""

from __future__ import annotations

import json
import os
import time
from typing import Any


def default_checkpoint_path() -> str:
    return os.environ.get(
        "EVAL_CHECKPOINT_PATH",
        os.path.join(os.environ.get("CACHE_DIR", "."), "eval_checkpoint.json"),
    )


def save_checkpoint(
    *,
    variant_id: str,
    last_query_id: str,
    processed_count: int,
    path: str | None = None,
) -> None:
    dest = path or default_checkpoint_path()
    os.makedirs(os.path.dirname(os.path.abspath(dest)), exist_ok=True)
    payload = {
        "variant_id": variant_id,
        "last_query_id": last_query_id,
        "processed_count": processed_count,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    tmp = f"{dest}.tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
    os.replace(tmp, dest)


def load_checkpoint(path: str | None = None) -> dict[str, Any] | None:
    dest = path or default_checkpoint_path()
    if not os.path.isfile(dest):
        return None
    with open(dest, encoding="utf-8") as handle:
        return json.load(handle)
