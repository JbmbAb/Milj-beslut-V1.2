# DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #176
**Gated candidate:** `65e3a0cdcfa9884f95fc59bfdc12718add5df57f`
**Merge commit:** `45ede2f1a5d814429ebccd01d30b63fc462e38ab`
**Merge tree:** `671ca17c4491a8550e07e69ff35442db502c8691`
**Candidate tree:** `671ca17c4491a8550e07e69ff35442db502c8691`

This record is introduced by its own DEV-GOV unit,
`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1-PROVEN-DOC-V1`.
Its final state takes effect when this record is itself merged through that gate.
It does not edit or replace the candidate record
`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1.md`.

## Anchors

- Base before implementation merge: `b3d1a93bb4b1f7142dc3263ace694768973b0122`
- Gated candidate: `65e3a0cdcfa9884f95fc59bfdc12718add5df57f`
- Promotion merge: `45ede2f1a5d814429ebccd01d30b63fc462e38ab`
- Promotion PR: #176
- Candidate and merge trees are byte-identical at the Git tree level.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36184550371`
- Canonical trusted evidence gate: `36193521449`
- Gate verdict: `PASS`, `proof_status: PROVEN`
- Proof cardinality: 8 executions (3 RED + 5 GREEN)
- Gate trust-policy digest:
  `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:65e3a0cdcfa9884f95fc59bfdc12718add5df57f`
- Required commit status:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA`

### RED proofs

- `dispatch-trigger-surface-exact`
- `dispatch-no-ref-selection-surface`
- `dispatch-attest-uses-pinned-ref`

All three RED executions ran against the protected base and observed the expected failure.

### GREEN proofs

- `dispatch-trigger-surface-exact`
- `dispatch-no-ref-selection-surface`
- `dispatch-attest-uses-pinned-ref`
- `dispatch-mutated-copy-inert-off-default-branch`
- `dispatch-workflow-regression-tests`

All five GREEN executions ran against the exact candidate and passed.

An additional live negative attack was performed before trusted dispatch:
attempting `workflow_dispatch` against the candidate branch for both
`devgov-v0-orchestrate.yml` and `devgov-v0-gate.yml` was rejected by GitHub with HTTP 422
because the candidate workflows expose no `workflow_dispatch` trigger.

## Merge topology and tree verification

PR #176 was merged with a merge commit pinned to the exact candidate SHA.
Squash and rebase were not used.

Merge parents:

1. `b3d1a93bb4b1f7142dc3263ace694768973b0122`
2. `65e3a0cdcfa9884f95fc59bfdc12718add5df57f`

Immediately after merge:

```text
tree(45ede2f1a5d814429ebccd01d30b63fc462e38ab)
==
tree(65e3a0cdcfa9884f95fc59bfdc12718add5df57f)
==
671ca17c4491a8550e07e69ff35442db502c8691
```

The diff between merge commit and candidate is empty.

## Proven claims

This unit proves the F-11 property only:

1. The protected gate and orchestrator no longer expose a candidate-selectable
   `workflow_dispatch` entry point.
2. Their protected entry point is `repository_dispatch`, whose event does not carry a caller-selected
   workflow ref and is resolved from the repository default branch.
3. The orchestrator''s RED/GREEN calls pin
   `JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-attest.yml@main`.
4. Removing the internal protected-branch guard from a candidate copy does not recreate a
   candidate-selectable controller entry point.
5. The trusted gate bound the exact candidate SHA before publishing success.

## Non-claims

This unit does **not**:

- migrate `GitHubDevGovDispatchAdapter` or `WorkflowDispatchCorrelator` from their dormant
  workflow-dispatch-shaped contract; that remains the separate mandatory
  `DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1` companion unit before production wiring;
- reopen, modify, or finalize DEVGOV-INVARIANT-PACKS-V1 / Step 5;
- claim F-01–F-14 have been rerun after this merge;
- change `devgov-v0-attest.yml`, signer authority, trust-policy schema, application code, or data.

At merge time the required trusted-execution status was green. Staging-proof, read-only Dev-Gov,
dependency review, and npm-audit checks were also green; several non-required CI/CodeQL jobs were
still running and were not used as authority for this promotion.

## Final disposition

`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1 = PROVEN`

The candidate-controlled workflow-selection path identified as F-11 is closed on protected `main`.
The adapter compatibility companion unit remains separate, after which Step 5 can be reconciled
onto the new protected main and all F-01–F-14 attacks rerun.
