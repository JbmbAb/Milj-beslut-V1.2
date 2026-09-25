# DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1 — PROVEN

**Final state:** PROVEN
**Promotion PR:** #174
**Gated candidate:** `cef9f381656ea3e54f3ffa782e7a3416fed5d77a`
**Merge commit:** `1b75361050102770aaa8efca46b51da9df5694b7`
**Merge tree:** `d9ae65bd8b34279a5ddcd6230531a62933acc149`
**Candidate tree:** `d9ae65bd8b34279a5ddcd6230531a62933acc149`

This record is introduced by its own DEV-GOV unit,
`DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1-PROVEN-DOC-V1`. The unit's final state takes effect
when this record is itself merged through that gate. It does not edit, and does not replace, the
candidate record `DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1.md`.

## Anchors

- Base before this merge (`main`): `9b3605c2f008983c93f89ef441165b35b37d6703`
- Gated candidate: `cef9f381656ea3e54f3ffa782e7a3416fed5d77a` (single implementation +
  packaging commit; no separate packaging commit was needed for this unit)

The packaging delta between the pre-merge base and the gated candidate is exactly five files:
`.github/workflows/devgov-v0-attest.yml`, `scripts/audit/devgovTrustedWorkflow.test.ts`,
`scripts/audit/devgovOrchestration.test.ts`,
`governance/devgov/units/devgov-attest-standalone-dispatch-closure-v1.json`, and
`docs/architecture/audits/DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1.md`.

## Trusted execution evidence

- Protected Dev-Gov orchestration run: `36108958125`
- Canonical trusted evidence gate: `36109489351`
- Gate verdict: `PASS`, `proof_status: PROVEN`, 4 proof ids (1 RED + 3 GREEN)
- Gate trust-policy digest: `2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5`
- Gate OIDC audience bound to the exact candidate SHA:
  `devgov-v0-gate:2c9ef79592495aba9dd2ddc7913e91f48b6f233b4aa35b9573848dfadec246d5:cef9f381656ea3e54f3ffa782e7a3416fed5d77a`
- Repository workflow `devgov-v0-gate.yml@refs/heads/main`; environment `devgov-attestation`;
  GitHub-hosted runner
- Required commit status on the candidate:
  - context: `DEV-GOV-V0 / trusted-execution`
  - state: `success`
  - description: `Trusted RED/GREEN verified for exact candidate SHA`

### Trusted RED (executed at `9b3605c2…`, observed `FAIL`, exit 1)

- `attest-workflow-call-only-trigger` — at base_sha, `.github/workflows/devgov-v0-attest.yml`
  still declares a standalone `workflow_dispatch` trigger coexisting with `workflow_call`; the
  presence of `workflow_call` is checked first as a positive control before the coexisting
  `workflow_dispatch` trigger is treated as the falsified property.

### Trusted GREEN (executed at the candidate, observed `PASS`, exit 0)

- `attest-workflow-call-only-trigger` (`workflow_call` is now the sole trigger under `on:`)
- `attest-workflow-call-caller-not-lost` (orchestrate.yml's `uses:
./.github/workflows/devgov-v0-attest.yml` reference remains intact; no script or test still
  expects the removed `workflow_dispatch` entry point)
- `attest-workflow-regression-tests` (the new regression assertion in
  `scripts/audit/devgovTrustedWorkflow.test.ts`, plus the corrected assertion in
  `scripts/audit/devgovOrchestration.test.ts`)

## Merge topology and tree verification

The candidate was merged with a merge commit only, through PR #174, pinned to the exact candidate
head SHA (`--match-head-commit`). Squash and rebase were not used.

Merge commit parents:

1. `9b3605c2f008983c93f89ef441165b35b37d6703`
2. `cef9f381656ea3e54f3ffa782e7a3416fed5d77a`

Immediately after the merge:

```text
tree(1b75361050102770aaa8efca46b51da9df5694b7)
==
tree(cef9f381656ea3e54f3ffa782e7a3416fed5d77a)
==
d9ae65bd8b34279a5ddcd6230531a62933acc149
```

Therefore the integration result is identical to the gated candidate tree. A diff between the
merge commit and the candidate is empty. The delta introduced against the pre-merge base is
exactly the five files declared in the unit's `allowed_paths`.

## Proven claims

DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1 proves only the following, as stated in the candidate
record:

1. `.github/workflows/devgov-v0-attest.yml`'s `on:` block declares `workflow_call` as its sole
   trigger; the standalone `workflow_dispatch` trigger that previously coexisted with it, and
   whose `execute` job carried no `environment:` gate (only a self-editable bash ref check), is
   removed.
2. No legitimate caller of the removed trigger existed: the only real consumer of
   `devgov-v0-attest.yml` is `devgov-v0-orchestrate.yml`'s `red`/`green` jobs, both via
   `uses: ./.github/workflows/devgov-v0-attest.yml` (`workflow_call`), unaffected by this change.
3. A new regression assertion in `scripts/audit/devgovTrustedWorkflow.test.ts` fails closed if a
   future change reintroduces `workflow_dispatch` on this file, and is wired into CI via
   `devgov-v0.yml`'s `pull_request.paths` filter on this exact file.

## Non-claims

This unit does **not**:

- change `.github/workflows/devgov-v0-gate.yml` or `.github/workflows/devgov-v0-orchestrate.yml`,
  or either workflow's own `workflow_dispatch` trigger — that is the separate, not-yet-started
  `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1` unit's scope (closing F-11);
- change `scripts/devgov/**`, `governance/devgov/schema/**`, the signer, or the trust policy;
- touch the DEVGOV-INVARIANT-PACKS-V1 ("Step 5") line of work or its F-10 finding in any way;
- fix the one pre-existing, unrelated test failure in `scripts/audit/devgovOrchestration.test.ts`
  (`'dispatches the canonical gate instead of trying to reuse its OIDC identity'`, about
  `devgov-v0-orchestrate.yml`'s own content) confirmed to already fail identically at base_sha —
  left for `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1` to pick up alongside its own changes to that
  file;
- make `scripts/dev-helpers/lib/unitLint.mjs`'s `DGL-003` finding on this unit's own definition
  (`forbidden_paths` cannot list the exact file this unit exists to edit) anything other than an
  expected, advisory-only, precedented (`dev-gov-v7-derived-target-identity.json`) non-error; the
  protected controller and the canonical gate remain the sole authority.

### Non-required PR checks at merge time

Branch protection on `main` requires only `DEV-GOV-V0 / trusted-execution`, which passed. The
following checks failed or were skipped on PR #174, consistent with the same pre-existing,
unrelated baseline failures observed on every precedent PR in this lineage (#161, #167, #170,
#172, #173): `Typecheck`, `Lint`, `Format check`, `Security audit`, `Read-only DEV-GOV-V0
validation`, and `Require staging proof in PR`. Each log was searched for this unit's file paths
(`devgov-v0-attest`, `devgovTrustedWorkflow`, `devgovOrchestration`); none appear as the cause of
any of these failures.

## Final disposition

`DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1 = PROVEN`

The currently-exploitable arbitrary-code-execution gap on `devgov-v0-attest.yml`'s standalone
`workflow_dispatch` entry point is closed on protected `main`. `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1`
may now proceed, based on this merge commit, to close the remaining, structurally distinct F-11
gap on `devgov-v0-gate.yml` and `devgov-v0-orchestrate.yml`.
