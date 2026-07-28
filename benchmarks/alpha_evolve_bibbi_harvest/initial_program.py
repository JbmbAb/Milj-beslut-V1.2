"""Initial program for Bibbi Harvest Orchestrator — Inventory-First Scheduling."""

from __future__ import annotations

from typing import Any, Mapping

from simulation import DatasetSpec, InventoryEntry, build_catalog, build_inventory, simulate_plan

# EVOLVE-BLOCK-START


def plan_harvest(
    inventory: list[InventoryEntry],
    catalog: list[DatasetSpec],
) -> list[dict[str, Any]]:
    """Return an ordered harvest plan for every catalog dataset.

    Naive baseline: fixed catalog order; SKIP only when complete hash matches.
    """
    inv_by_id = {entry.dataset_id: entry for entry in inventory}
    plan: list[dict[str, Any]] = []

    for rank, spec in enumerate(catalog):
        entry = inv_by_id[spec.dataset_id]
        if entry.local_state == "complete" and entry.local_hash == spec.remote_hash:
            action = "SKIP"
        elif entry.local_state == "partial":
            action = "DOWNLOAD"
        elif entry.local_state == "stale":
            action = "DOWNLOAD"
        else:
            action = "DOWNLOAD"

        plan.append(
            {
                "dataset_id": spec.dataset_id,
                "action": action,
                "priority_rank": rank,
            }
        )

    return plan


# EVOLVE-BLOCK-END


def evaluate(eval_inputs: Mapping[str, Any]) -> dict[str, float]:
    """Run the benchmark simulation and return composite score."""
    seed = int(eval_inputs["seed"])
    dataset_count = int(eval_inputs["dataset_count"])
    failure_rate_base = float(eval_inputs["failure_rate_base"])

    catalog = build_catalog(seed, dataset_count, failure_rate_base)
    inventory = build_inventory(seed, catalog)
    plan = plan_harvest(inventory, catalog)
    metrics = simulate_plan(plan, catalog, inventory, seed)
    return {"score": float(metrics["score"])}


if __name__ == "__main__":
    result = evaluate({"seed": 42, "dataset_count": 24, "failure_rate_base": 0.08})
    print(result)
