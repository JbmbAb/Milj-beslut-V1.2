# Status: REGRESSION BASELINE — FROZEN

**Frozen:** 2026-08-11
**Governs:** Claude's chunking-strategy decisions in `packages/mps-chunking` and `packages/mps-text-projection`. See `SKILL.md` for the enforced rule and workflow; see `docs/architecture/ADR-CHUNKING-Subsystem.md` for the architectural decision this skill enforces.

## What is proven, and what isn't

Four regression cases (`evals/evals.json`, detailed in `evals/README.md`) confirm the skill enforces its stated rule against three specific dangerous edge cases: inventing/blending a new strategy without a decision, mutating an approved strategy's output semantics without a version bump, and letting a near-fit slide into implementation instead of stopping for a detector-defect check.

Result: 4/4 regression cases pass on the current skill version (`evals/benchmark-iteration-1-baseline-vs-skill.json`/`.md` shows 100% vs. a 52% no-skill baseline on iteration 1; the Step 3 diagnostic addition was re-verified at 4/4 in iteration 2, not separately archived as JSON — see the README's iteration-2 note).

**Scope of that claim:** this is an internal regression measure for four specific defined behaviors, not a general quality or coverage claim about chunking strategy in this repo. It does not mean chunking is "solved," that the four approved strategies (`law`/`court`/`evidence`/`standard`) are sufficient for all future document types, or that no other chunking-quality issues exist. It means: these four documented failure modes are caught, today, by this skill version.

## Change policy

Do not edit `SKILL.md`'s workflow or rule wording without re-running all four cases in `evals/evals.json` first. If a case that used to pass starts failing, the edit weakened the gate regardless of how the new wording reads. Add a new regression case here (rather than just editing the skill) if a new failure mode is discovered.

## Provenance

Source skill developed via `skill-creator`, benchmarked with-skill vs. baseline (no skill) using Claude Sonnet 5 subagents against this repository's actual `mps-chunking`/`mps-text-projection` source, 2026-08-10/11.
