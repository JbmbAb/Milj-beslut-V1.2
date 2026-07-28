# Bibbi Harvest Orchestrator — Inventory-First Scheduling

AlphaEvolve experiment that evolves Bibbi's harvest scheduling logic: skip redundant downloads, resume partials, and prioritize tier-1 datasets — aligned with Mimers Brunn offline-first policy.

## Files

| File | Purpose |
|------|---------|
| `initial_program.py` | Seed scheduler with EVOLVE-BLOCK markers |
| `simulation.py` | Deterministic benchmark catalog + scoring |
| `evaluator.py` | CLI-compatible evaluator for the `ae` CLI |
| `problem_description.md` | Full problem spec for LLM prompts |
| `test_program.py` | Tests for the initial program |
| `test_evaluator.py` | Tests for the evaluator |
| `example_evaluation.json` | Baseline evaluator output |
| `pyproject.toml` | uv project configuration |

## Running Tests

```bash
cd benchmarks/alpha_evolve_bibbi_harvest
uv sync
uv run pytest -v
```

## Metric

- **Name:** `score`
- **Direction:** maximize
- **Strategy:** COMPOSITE_MULTI_OBJECTIVE

## Launching

Use the `alpha-evolve-runner` skill or the `ae` CLI to launch this experiment.

## Integration target

After evolution, port the winning `plan_harvest()` logic to TypeScript in a Bibbi orchestrator module under `scripts/import/` or `server/modules/`.
