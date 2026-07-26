"""AlphaEvolve-compatible evaluator facade for rerank prompt scoring."""

from __future__ import annotations

from eval import (
    HARD_FAILURE_RATE,
    WARNING_FAILURE_RATE,
    build_pareto_summary,
    normalize_record,
    pick_best_variant,
    score_prompt_variant,
)

__all__ = [
    "HARD_FAILURE_RATE",
    "WARNING_FAILURE_RATE",
    "build_pareto_summary",
    "normalize_record",
    "pick_best_variant",
    "score_prompt_variant",
]
