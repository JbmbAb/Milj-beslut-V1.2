"""Legal search parameter seed for AlphaEvolve (design phase)."""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Mapping

FAILURE_PENALTY = -1_000_000.0

# EVOLVE-BLOCK-START


@dataclass(frozen=True)
class SearchParams:
    """Mirrors Miljöbeslut searchService + searchLegalCorpusTool defaults."""

    RRF_K: int = 60
    FTS_CANDIDATE_LIMIT: int = 50
    VECTOR_CANDIDATE_LIMIT: int = 50
    RRF_CANDIDATE_LIMIT: int = 30
    RERANKER_FINAL_K: int = 8
    LEGAL_RERANKER_RELATIVE_GAP: float = 0.15


def build_search_params() -> SearchParams:
    return SearchParams()


# EVOLVE-BLOCK-END


def _eval_set_path() -> Path:
    return Path(__file__).resolve().parent.parent / "eval-set.json"


def load_eval_set() -> dict[str, Any]:
    injected = globals().get("_INJECTED_EVAL_SET")
    if isinstance(injected, dict):
        return injected
    return json.loads(_eval_set_path().read_text(encoding="utf-8"))


def validate_params(params: SearchParams, constraints: dict[str, dict[str, float]]) -> bool:
    data = asdict(params)
    for key, bounds in constraints.items():
        if key not in data:
            return False
        value = data[key]
        if value < bounds["min"] or value > bounds["max"]:
            return False
    return True


def proxy_recall(params: SearchParams, case: dict[str, Any]) -> float:
    """Design-phase proxy: higher candidate limits imply better recall ceiling."""
    del case
    base = 0.55
    fusion_boost = min(params.RRF_CANDIDATE_LIMIT / 60.0, 1.0) * 0.15
    fts_boost = min(params.FTS_CANDIDATE_LIMIT / 100.0, 1.0) * 0.1
    vector_boost = min(params.VECTOR_CANDIDATE_LIMIT / 100.0, 1.0) * 0.1
    rerank_boost = min(params.RERANKER_FINAL_K / 20.0, 1.0) * 0.05
    gap_penalty = abs(params.LEGAL_RERANKER_RELATIVE_GAP - 0.15) * 0.2
    return min(1.0, base + fusion_boost + fts_boost + vector_boost + rerank_boost - gap_penalty)


def evaluate(eval_inputs: Mapping[str, Any] | None = None) -> dict[str, Any]:
    eval_set = load_eval_set()
    constraints = eval_set["constraints"]
    params = build_search_params()

    if not validate_params(params, constraints):
        return {
            "neg_weighted_recall": FAILURE_PENALTY,
            "failure_reason": "params_out_of_bounds",
        }

    start = time.perf_counter()
    recalls: list[float] = []
    for case in eval_set["cases"]:
        recalls.append(proxy_recall(params, case))
    elapsed_ms = (time.perf_counter() - start) * 1000.0

    weighted = sum(recalls) / max(len(recalls), 1)
    return {
        "neg_weighted_recall": float(weighted),
        "p95_latency_ms": float(elapsed_ms),
        "mean_recall": float(weighted),
        "param_snapshot": asdict(params),
    }
