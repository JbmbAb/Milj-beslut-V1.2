"""AlphaEvolve evaluator for legal search params (design phase)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .program import FAILURE_PENALTY, evaluate

METRIC_NAME = "neg_weighted_recall"
_EXPERIMENT_ROOT = Path(__file__).resolve().parent.parent
_EVAL_SET = json.loads((_EXPERIMENT_ROOT / "eval-set.json").read_text(encoding="utf-8"))
_REPO_ROOT = _EXPERIMENT_ROOT.parents[3]


def _load_initial_program() -> str:
    path = os.path.join(os.path.dirname(__file__), "program.py")
    with open(path, encoding="utf-8") as handle:
        return handle.read()


INITIAL_PROGRAM_CODE = _load_initial_program()


def legal_search_params_evaluation(program_candidate: dict) -> dict:
    code = program_candidate["content"]["files"][0]["content"]
    score_value: float | None = None
    insights: list[dict[str, str]] = []

    try:
        exec_namespace: dict[str, Any] = {
            "Mapping": dict,
            "Any": Any,
            "_INJECTED_EVAL_SET": _EVAL_SET,
            "_REPO_ROOT": str(_REPO_ROOT),
        }
        exec(code, exec_namespace)
        eval_func = exec_namespace.get("evaluate")
        if not callable(eval_func):
            insights.append(
                {
                    "label": "Invalid Program Structure",
                    "text": "Missing callable evaluate().",
                }
            )
            score_value = FAILURE_PENALTY
        else:
            result = eval_func({})
            metric = result.get(METRIC_NAME)
            if metric is None:
                score_value = FAILURE_PENALTY
            else:
                score_value = float(metric)
                if score_value <= FAILURE_PENALTY / 2:
                    reason = result.get("failure_reason", "evaluation_failed")
                    insights.append({"label": "Evaluation Failed", "text": str(reason)})
                snapshot = result.get("param_snapshot")
                if snapshot:
                    insights.append(
                        {
                            "label": "Params",
                            "text": str(snapshot),
                        }
                    )
    except Exception as exc:
        insights.append({"label": "Runtime Error", "text": str(exc)})
        score_value = FAILURE_PENALTY

    payload: dict[str, Any] = {
        "scores": {"scores": [{"metric": METRIC_NAME, "score": score_value}]},
    }
    if insights:
        payload["insights"] = {"insights": insights}
    return payload
