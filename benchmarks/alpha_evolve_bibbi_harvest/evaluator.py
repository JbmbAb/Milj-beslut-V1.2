"""Evaluator for Bibbi Harvest Orchestrator benchmark."""

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import math
import signal
import sys
import traceback
from pathlib import Path
from types import ModuleType
from typing import Any

EVALUATION_METRIC = "score"
EVALUATION_INPUTS = {"seed": 42, "dataset_count": 24, "failure_rate_base": 0.08}
FAILURE_SCORE = -1_000_000_000.0


class EvaluationTimeoutError(Exception):
    pass


def _timeout_handler(signum, frame):  # noqa: ARG001
    raise EvaluationTimeoutError("Evaluation timed out")


if hasattr(signal, "SIGALRM"):
    signal.signal(signal.SIGALRM, _timeout_handler)


def _load_module(module_name: str, file_path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load module from {file_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def _failure(
    error: str,
    tb: str | None = None,
    stdout: str = "",
    stderr: str = "",
) -> dict[str, Any]:
    insights = [{"label": "error", "text": error}]
    if tb:
        insights.append({"label": "traceback", "text": tb})
    if stdout:
        insights.append({"label": "stdout", "text": stdout})
    if stderr:
        insights.append({"label": "stderr", "text": stderr})
    return {"score": None, "insights": insights}


def evaluate_program(code: str, timeout_seconds: int = 10) -> dict[str, Any]:
    stdout_capture = io.StringIO()
    stderr_capture = io.StringIO()

    try:
        if hasattr(signal, "alarm"):
            signal.alarm(timeout_seconds)

        namespace: dict[str, Any] = {"__name__": "candidate_program"}
        with (
            contextlib.redirect_stdout(stdout_capture),
            contextlib.redirect_stderr(stderr_capture),
        ):
            exec(code, namespace)  # noqa: S102
            eval_func = namespace.get("evaluate")
            if not callable(eval_func):
                return _failure(
                    "Program missing callable evaluate()",
                    stdout=stdout_capture.getvalue(),
                    stderr=stderr_capture.getvalue(),
                )
            result = eval_func(EVALUATION_INPUTS)

        raw_score = result.get(EVALUATION_METRIC)
        if raw_score is None:
            return _failure(
                f"Metric {EVALUATION_METRIC!r} missing",
                stdout=stdout_capture.getvalue(),
                stderr=stderr_capture.getvalue(),
            )
        if not isinstance(raw_score, (int, float)):
            return _failure(f"Invalid score type: {type(raw_score)!r}")
        if math.isnan(raw_score) or math.isinf(raw_score):
            return _failure(f"Non-finite score: {raw_score}")

        score = float(raw_score)
        if score <= FAILURE_SCORE / 10:
            return _failure(
                f"Policy violation score: {score}",
                stdout=stdout_capture.getvalue(),
                stderr=stderr_capture.getvalue(),
            )

        insights = []
        if stdout_capture.getvalue():
            insights.append({"label": "stdout", "text": stdout_capture.getvalue()})
        if stderr_capture.getvalue():
            insights.append({"label": "stderr", "text": stderr_capture.getvalue()})
        insights.append({"label": "score_detail", "text": json.dumps(result)})
        return {"score": score, "insights": insights}

    except EvaluationTimeoutError:
        return _failure(
            f"Evaluation timed out after {timeout_seconds}s",
            tb=traceback.format_exc(),
            stdout=stdout_capture.getvalue(),
            stderr=stderr_capture.getvalue(),
        )
    except Exception as exc:  # noqa: BLE001
        return _failure(
            f"Evaluation failed: {exc}",
            tb=traceback.format_exc(),
            stdout=stdout_capture.getvalue(),
            stderr=stderr_capture.getvalue(),
        )
    finally:
        if hasattr(signal, "alarm"):
            signal.alarm(0)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-file", required=True)
    parser.add_argument("--program-dir", required=True)
    args = parser.parse_args()

    program_dir = Path(args.program_dir)
    sys.path.insert(0, str(program_dir))

    # Load simulation helper used by candidate programs.
    _load_module("simulation", program_dir / "simulation.py")

    code = (program_dir / "initial_program.py").read_text(encoding="utf-8")
    result = evaluate_program(code)

    with open(args.output_file, "w", encoding="utf-8") as f:
        json.dump(result, f)


if __name__ == "__main__":
    main()
