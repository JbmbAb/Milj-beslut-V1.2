"""Deterministic harvest simulation for Bibbi orchestrator benchmarks."""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Any, Literal

LocalState = Literal["none", "partial", "complete", "stale"]
Action = Literal["SKIP", "DOWNLOAD", "RESUME", "REHARVEST"]

VALID_ACTIONS = {"SKIP", "DOWNLOAD", "RESUME", "REHARVEST"}


@dataclass(frozen=True)
class DatasetSpec:
    dataset_id: str
    tier: int
    size_mb: float
    remote_hash: str
    failure_rate: float


@dataclass(frozen=True)
class InventoryEntry:
    dataset_id: str
    local_state: LocalState
    local_hash: str | None
    partial_pct: float


def build_catalog(seed: int, dataset_count: int, failure_rate_base: float) -> list[DatasetSpec]:
    rng = random.Random(seed)
    tiers = [1, 1, 1, 2, 2, 2, 3, 3]
    catalog: list[DatasetSpec] = []
    for i in range(dataset_count):
        tier = tiers[i % len(tiers)]
        size_mb = round(rng.uniform(20, 400), 1)
        remote_hash = f"sha256:{seed:04x}-{i:03d}-remote"
        failure_rate = min(0.35, failure_rate_base + (0.03 if tier == 1 else 0.0) + rng.uniform(0, 0.05))
        catalog.append(
            DatasetSpec(
                dataset_id=f"ds_{i:03d}",
                tier=tier,
                size_mb=size_mb,
                remote_hash=remote_hash,
                failure_rate=failure_rate,
            )
        )
    return catalog


def build_inventory(seed: int, catalog: list[DatasetSpec]) -> list[InventoryEntry]:
    rng = random.Random(seed + 17)
    states: list[LocalState] = ["none", "partial", "complete", "stale"]
    inventory: list[InventoryEntry] = []
    for spec in catalog:
        local_state = states[rng.randrange(len(states))]
        if local_state == "complete":
            # 75% matching hash, 25% stale hash while marked complete (bad metadata)
            local_hash = spec.remote_hash if rng.random() < 0.75 else f"sha256:old-{spec.dataset_id}"
        elif local_state == "stale":
            local_hash = f"sha256:old-{spec.dataset_id}"
        elif local_state == "partial":
            local_hash = None
        else:
            local_hash = None
        partial_pct = round(rng.uniform(0.15, 0.85), 2) if local_state == "partial" else 0.0
        inventory.append(
            InventoryEntry(
                dataset_id=spec.dataset_id,
                local_state=local_state,
                local_hash=local_hash,
                partial_pct=partial_pct,
            )
        )
    return inventory


def inventory_map(inventory: list[InventoryEntry]) -> dict[str, InventoryEntry]:
    return {entry.dataset_id: entry for entry in inventory}


def expected_action(entry: InventoryEntry, spec: DatasetSpec) -> Action:
    if entry.local_state == "complete" and entry.local_hash == spec.remote_hash:
        return "SKIP"
    if entry.local_state == "partial":
        return "RESUME"
    if entry.local_state == "stale" or (
        entry.local_state == "complete" and entry.local_hash != spec.remote_hash
    ):
        return "REHARVEST"
    return "DOWNLOAD"


def simulate_plan(
    plan: list[dict[str, Any]],
    catalog: list[DatasetSpec],
    inventory: list[InventoryEntry],
    seed: int,
) -> dict[str, float]:
    inv_by_id = inventory_map(inventory)
    cat_by_id = {c.dataset_id: c for c in catalog}
    rng = random.Random(seed + 99)

    if len(plan) != len(catalog):
        return {"score": -1_000_000.0}

    seen: set[str] = set()
    wrong_skip = 0
    wrong_redownload = 0
    wrong_action = 0
    mb_downloaded = 0.0
    mb_saved = 0.0
    completed_weight = 0.0
    max_weight = 0.0
    priority_penalty = 0.0

    tier_weights = {1: 3.0, 2: 2.0, 3: 1.0}

    for spec in catalog:
        max_weight += tier_weights[spec.tier]

    executed_order: list[tuple[int, str, bool]] = []

    for rank, item in enumerate(plan):
        dataset_id = item.get("dataset_id")
        action = item.get("action")
        if dataset_id in seen:
            return {"score": -1_000_000.0}
        seen.add(dataset_id)

        if dataset_id not in cat_by_id or dataset_id not in inv_by_id:
            return {"score": -1_000_000.0}
        if action not in VALID_ACTIONS:
            return {"score": -1_000_000.0}

        entry = inv_by_id[dataset_id]
        expected = expected_action(entry, spec := cat_by_id[dataset_id])

        if action != expected:
            wrong_action += 1

        if action == "SKIP" and expected != "SKIP":
            wrong_skip += 1
        if action in {"DOWNLOAD", "REHARVEST"} and expected == "SKIP":
            wrong_redownload += 1

        success = True
        if action == "SKIP":
            mb_saved += spec.size_mb
        elif action == "RESUME":
            remaining = spec.size_mb * max(0.05, 1.0 - entry.partial_pct)
            mb_downloaded += remaining
            success = rng.random() > spec.failure_rate
        else:
            mb_downloaded += spec.size_mb
            success = rng.random() > spec.failure_rate

        executed_order.append((spec.tier, dataset_id, success))
        if success:
            completed_weight += tier_weights[spec.tier]

    # Priority: tier-1 successes should appear earlier than tier-3 on average
    tier1_positions = [i for i, (t, _, ok) in enumerate(executed_order) if t == 1 and ok]
    tier3_positions = [i for i, (t, _, ok) in enumerate(executed_order) if t == 3 and ok]
    if tier1_positions and tier3_positions:
        if sum(tier1_positions) / len(tier1_positions) > sum(tier3_positions) / len(tier3_positions):
            priority_penalty += 50.0

    correct = len(catalog) - wrong_action
    correctness_ratio = correct / len(catalog)
    completion_ratio = completed_weight / max_weight if max_weight else 0.0
    bandwidth_score = mb_saved / max(1.0, mb_saved + mb_downloaded)

    score = (
        400.0 * correctness_ratio
        + 250.0 * completion_ratio
        + 150.0 * bandwidth_score
        - 500.0 * wrong_skip
        - 200.0 * wrong_redownload
        - 50.0 * wrong_action
        - priority_penalty
    )
    return {
        "score": score,
        "correctness_ratio": correctness_ratio,
        "completion_ratio": completion_ratio,
        "bandwidth_score": bandwidth_score,
        "mb_downloaded": mb_downloaded,
        "mb_saved": mb_saved,
        "wrong_skip": float(wrong_skip),
        "wrong_redownload": float(wrong_redownload),
    }
