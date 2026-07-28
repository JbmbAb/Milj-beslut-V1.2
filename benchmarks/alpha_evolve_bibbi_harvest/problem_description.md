# Bibbi Harvest Orchestrator — Inventory-First Scheduling

## Problem Statement

Mimer Bibliotekarie (Bibbi) ska planera nationell geodata-harvest enligt Mimers Brunn: **inventera först**, ladda inte ner det som redan är canonical, återuppta partials, och re-harvesta stale dataset.

Given:

- `catalog`: list of datasets with `dataset_id`, `tier` (1=highest), `size_mb`, `remote_hash`, `failure_rate`
- `inventory`: local archive state per dataset: `local_state` ∈ {none, partial, complete, stale}, optional `local_hash`, `partial_pct`

Produce:

- `plan`: ordered list of `{dataset_id, action, priority_rank}` where `action` ∈ {SKIP, DOWNLOAD, RESUME, REHARVEST}

## Formal Specification

For each dataset *d* with inventory entry *I(d)* and catalog spec *C(d)*:

| Condition | Correct action |
|-----------|----------------|
| complete ∧ local_hash = remote_hash | SKIP |
| partial | RESUME |
| stale ∨ (complete ∧ hash mismatch) | REHARVEST |
| none | DOWNLOAD |

Objective (maximize composite `score`):

- Correctness ratio (matching expected actions)
- Completion ratio weighted by tier after simulated failures
- Bandwidth saved by skipping complete datasets
- Penalties: wrong SKIP (-500), wrong re-download (-200), deprioritized tier-1 work (-50)

## Evaluation

- **Metric:** `score` (maximize)
- **Strategy:** COMPOSITE_MULTI_OBJECTIVE (scalarized)
- **Inputs:** seed=42, dataset_count=24, failure_rate_base=0.08

## Solution Guidance

Strong schedulers typically:

1. Build hash-aware lookup from inventory
2. Sort by tier ascending, then size descending within tier
3. Map state → action deterministically
4. Never emit DOWNLOAD for canonical complete datasets
5. Use RESUME for partial (saves bandwidth vs full DOWNLOAD)

Common pitfalls:

- Treating partial as DOWNLOAD (penalized)
- Ignoring tier ordering (priority penalty)
- Skipping stale/complete-with-wrong-hash datasets
