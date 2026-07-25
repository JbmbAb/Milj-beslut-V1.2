"""Legal search parameter seed for AlphaEvolve."""

from __future__ import annotations

import json
import platform
import subprocess
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
    RRF_K_EXACT: int = 30
    FTS_CANDIDATE_LIMIT: int = 50
    VECTOR_CANDIDATE_LIMIT: int = 50
    RRF_CANDIDATE_LIMIT: int = 30
    RERANKER_FINAL_K: int = 8
    LEGAL_RERANKER_RELATIVE_GAP: float = 0.15


def build_search_params() -> SearchParams:
    return SearchParams()


# EVOLVE-BLOCK-END


def _repo_root() -> Path:
    injected = globals().get("_REPO_ROOT")
    if injected:
        return Path(str(injected))
    return Path(__file__).resolve().parents[5]


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


def run_fixture_eval(params: SearchParams) -> dict[str, Any]:
    """Phase 2: score params via run_eval.ts + fixed legal corpus fixtures."""
    script = _repo_root() / "scripts/alphaevolve/experiments/legal_search_params/run_eval.ts"
    payload = {**asdict(params), "rerankerEnabled": True}
    cwd = str(_repo_root())
    if platform.system() == "Windows":
        completed = subprocess.run(
            f'npx tsx "{script}"',
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            cwd=cwd,
            shell=True,
            check=False,
        )
    else:
        completed = subprocess.run(
            ["npx", "tsx", str(script)],
            input=json.dumps(payload),
            capture_output=True,
            text=True,
            cwd=cwd,
            check=False,
        )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or f"run_eval exited {completed.returncode}")
    return json.loads(completed.stdout.strip())


def evaluate(eval_inputs: Mapping[str, Any] | None = None) -> dict[str, Any]:
    del eval_inputs
    eval_set = load_eval_set()
    constraints = eval_set["constraints"]
    params = build_search_params()

    if not validate_params(params, constraints):
        return {
            "neg_weighted_recall": FAILURE_PENALTY,
            "failure_reason": "params_out_of_bounds",
        }

    start = time.perf_counter()
    try:
        result = run_fixture_eval(params)
    except Exception as exc:
        return {
            "neg_weighted_recall": FAILURE_PENALTY,
            "failure_reason": f"run_eval_failed:{exc}",
        }

    elapsed_ms = (time.perf_counter() - start) * 1000.0
    mean_recall = float(result.get("mean_recall", result.get("neg_weighted_recall", 0.0)))

    return {
        "neg_weighted_recall": mean_recall,
        "p95_latency_ms": float(result.get("p95_latency_ms", elapsed_ms)),
        "mean_recall": mean_recall,
        "per_case": result.get("per_case", []),
        "param_snapshot": asdict(params),
        "eval_mode": "fixtures_v2",
    }
