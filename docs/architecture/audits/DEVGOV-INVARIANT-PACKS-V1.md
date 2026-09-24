# DEVGOV-INVARIANT-PACKS-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN  
**Frozen base:** `9b3605c2f008983c93f89ef441165b35b37d6703`  
**Implementation head before packaging:** `1b8dd49406fdd33e94f471ff7167891281a32da9`  
**Unit:** `DEVGOV-INVARIANT-PACKS-V1`

## Purpose

Step 5 of the frozen DEV-GOV sequence introduces controller-owned invariant packs.

The active pack set is resolved from the protected controller checkout. The candidate is only the
target being inspected; it cannot select, replace, omit, or version the pack set that judges a run.

## Frozen claims

1. Every orchestrated DEV-GOV unit runs all active controller-owned packs before declared RED/GREEN.
2. The canonical trusted gate runs all active packs again before obtaining protected gate identity
   and before it can publish `DEV-GOV-V0 / trusted-execution = success`.
3. A separate `pull_request_target` workflow applies the protected-base pack set to every PR head.
4. The pack CLI exposes only `--target`, `--candidate-sha`, and `--output`; there is no caller
   `--pack` or version selector.
5. The report binds controller SHA, candidate SHA, registry version, and a digest of the effective
   registry + pack set.
6. V1 freezes eight controller meta-invariants: controller/candidate separation, signer isolation,
   exact-candidate binding, verifier-owned trust, load-bearing pack execution, no candidate pack
   selection, protected-base all-PR evaluation, and post-merge activation.
7. The stale `devgovOrchestration.test.ts` assertion is corrected to the existing canonical
   `gh run watch ... --repo ... --exit-status` command; no controller behavior changes for that fix.

## Bootstrap rule

V1 is the bootstrap pack and therefore cannot be judged by a pre-existing pack system that does
not yet exist. Its authoritative admission still uses the already-protected DEV-GOV controller,
trusted RED/GREEN attestations, canonical evidence gate, cold review, and exact merge-tree checks.

From V2 onward, anti-self-bootstrap is mechanical: the current protected/base pack set judges the
candidate. A candidate's proposed registry or pack version is target data only and becomes normative
only after merge to the protected controller. Pack changes must remain separate from product code.

## Implementation

Implementation head `1b8dd49406fdd33e94f471ff7167891281a32da9` changes only DEV-GOV
controller/workflow/audit files plus the invariant-pack registry. It changes no LU/product runtime.

The implementation consists of ten paths:

- `.github/workflows/devgov-invariant-packs.yml`
- `.github/workflows/devgov-v0-gate.yml`
- `.github/workflows/devgov-v0-orchestrate.yml`
- `.github/workflows/devgov-v0.yml`
- `governance/devgov/invariant-packs/devgov-controller-core-v1.json`
- `governance/devgov/invariant-packs/registry-v1.json`
- `scripts/audit/devgovInvariantPacks.test.ts`
- `scripts/audit/devgovOrchestration.test.ts`
- `scripts/audit/devgovTrustedWorkflow.test.ts`
- `scripts/devgov/invariant-packs.mjs`

During author-side falsification, an initial self-check defect was found: the runner attempted to
prove absence of a `--pack` switch by searching its own source for that literal, while the check
itself contained the literal. That implementation was not packaged. The corrected check derives the
actual CLI options from the parser and requires exactly three allowed flags.

An independent static reread of the corrected implementation evaluated all eight frozen invariants
and returned 8/8 PASS before packaging.

## RED

RED runs on frozen base and first verifies the old protected controller/gate dispatch exists as a
positive control. Complete absence of the new invariant-pack machinery is then the expected semantic
FAIL. Partial installation or missing positive controls are harness errors and are blocked.

## GREEN

The exact candidate must pass:

1. structural V1 presence/binding proof;
2. live invariant-pack evaluation;
3. focused pack/orchestration/trusted-workflow tests;
4. the complete `npm run devgov:test` suite;
5. targeted Prettier for all implementation paths.

## Cold-review requirement

Because this changes controller-owned governance, an independent cold review is required before
merge. The review must try to falsify, at minimum:

- candidate pack selection or registry substitution;
- removal/skipping of pack execution for a unit or PR;
- gate success without pack PASS;
- V2 becoming normative before merge;
- candidate-code execution in the protected all-PR check;
- controller/signer/trust-policy authority widening.

Cold review is independent evidence; it does not replace trusted RED/GREEN.

## Non-claims

This unit does not prove product correctness, replace unit-specific RED/GREEN, create a non-impact
graph, allow pack skipping, introduce proof bundles, implement plan-first or classification, or make
the candidate authoritative before merge. It does not change product/runtime code or trust roots.

The all-PR workflow introduced by V1 becomes effective only after V1 itself is merged; GitHub cannot
run a newly introduced `pull_request_target` workflow from a base branch on which that workflow
does not yet exist. This is part of the explicit V1 bootstrap exception, not a permanent bypass.

## Finalization

Remain CANDIDATE until: cold review passes; trusted RED/GREEN and canonical gate succeed on the exact
candidate; the exact candidate is merged without bypass; candidate tree equals merge tree; and a
separate PROVEN record is admitted.
