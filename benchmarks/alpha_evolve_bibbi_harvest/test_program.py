"""Tests for the initial Bibbi harvest orchestrator program."""

from initial_program import evaluate, plan_harvest
from simulation import build_catalog, build_inventory


def test_plan_harvest_returns_one_action_per_dataset():
    catalog = build_catalog(seed=7, dataset_count=12, failure_rate_base=0.08)
    inventory = build_inventory(seed=7, catalog=catalog)
    plan = plan_harvest(inventory, catalog)
    assert len(plan) == len(catalog)
    assert {p["dataset_id"] for p in plan} == {c.dataset_id for c in catalog}


def test_evaluate_returns_dict_with_metric():
    result = evaluate({"seed": 42, "dataset_count": 24, "failure_rate_base": 0.08})
    assert "score" in result


def test_evaluate_returns_finite_score():
    result = evaluate({"seed": 42, "dataset_count": 24, "failure_rate_base": 0.08})
    score = result["score"]
    assert isinstance(score, (int, float))
    assert score > -1_000_000
