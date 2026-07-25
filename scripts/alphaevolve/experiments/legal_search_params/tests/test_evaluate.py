import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.evaluate import INITIAL_PROGRAM_CODE, legal_search_params_evaluation
from src.program import FAILURE_PENALTY, build_search_params


def test_seed_params_within_bounds():
    params = build_search_params()
    assert params.RRF_K == 60
    assert params.RERANKER_FINAL_K == 8


def test_seed_evaluates():
    result = legal_search_params_evaluation(
        {"content": {"files": [{"content": INITIAL_PROGRAM_CODE}]}}
    )
    score = result["scores"]["scores"][0]["score"]
    assert score is not None
    assert score > FAILURE_PENALTY / 2


def test_out_of_bounds_penalized():
    bad = INITIAL_PROGRAM_CODE.replace("RRF_K: int = 60", "RRF_K: int = 999")
    result = legal_search_params_evaluation({"content": {"files": [{"content": bad}]}})
    score = result["scores"]["scores"][0]["score"]
    assert score == FAILURE_PENALTY
