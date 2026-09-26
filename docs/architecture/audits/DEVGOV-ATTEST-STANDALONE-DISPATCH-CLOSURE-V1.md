# DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `9b3605c2f008983c93f89ef441165b35b37d6703`
**Unit:** `DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1`
**Classification:** BLOCKING security closure, fast-tracked, owner-authorized 2026-09-25.

## Purpose

Remove a live, independently-exploitable arbitrary-code-execution entry point from
`.github/workflows/devgov-v0-attest.yml`, discovered during an unrelated DispatchV1 research pass.
This unit does exactly one thing: delete the file's standalone `workflow_dispatch` trigger so
`workflow_call` (the only trigger anything in this repository actually uses) remains the sole way to
invoke the workflow.

## Vulnerability

At `base_sha` (`9b3605c2f0…`), `.github/workflows/devgov-v0-attest.yml` declared **two** triggers
under `on:`:

- `workflow_call` (lines 4–21) — the reusable-workflow trigger `devgov-v0-orchestrate.yml`'s `red`
  and `green` jobs invoke via `uses: ./.github/workflows/devgov-v0-attest.yml`. This is the only
  caller anything in the repository has for this file.
- `workflow_dispatch` (lines 22–42) — a **standalone** trigger nothing in the repository calls.

The `execute` job (`jobs.execute`, lines 47–223 at base) that `workflow_dispatch` invokes carries
**no `environment:` gate**, unlike `jobs.attest` (line 229 at base), which correctly requires
`environment: devgov-attestation`. `execute`'s only defense is a self-editable bash step —
`Require protected default-branch workflow` (lines 52–57 at base) — that compares `github.ref`
against the repository's default branch.

Because `workflow_dispatch` resolves the _workflow definition_ from whichever ref the caller
selects, this defense does not hold: an attacker with push + Actions-dispatch access (no admin, no
secrets) can push a branch, delete that one guard step in their own copy of the file, and dispatch
it. GitHub runs their copy's `execute` job — arbitrary shell, `npm ci`, etc. — on a GitHub-hosted
runner, unattended, with no reviewer or environment gate. This is a real, live,
currently-exploitable gap, independent of every other Dev-Gov unit.

## Why the signing job is not equivalently exposed

`jobs.attest` is not reachable the same way:

- `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM` is injected only into a job that keeps
  `environment: devgov-attestation` — a server-enforced GitHub Environment gate an attacker's own
  YAML edits cannot fake or route around.
- Even a forged off-branch run's signed `workflow_ref` claim would be rejected downstream by
  `trusted-attestation.mjs`'s pinned-authority check (see `governance/devgov/units/README.md` for
  the pinned `workflow_ref` and OIDC-audience binding this repository's trust policy requires).

So this unit's fix does not need to touch anything about signing, key material, or the trust
policy.

## Fix

`.github/workflows/devgov-v0-attest.yml`: deleted the standalone `workflow_dispatch:` trigger block
(former lines 22–42) in full. `workflow_call:` (former lines 4–21) is untouched and is now the only
key under `on:`. No job, step, permission, or secret reference changed.

```diff
 on:
   workflow_call:
     inputs:
       candidate_sha: {...}
       unit_definition_path: {...}
       proof_kind: {...}
       test_id: {...}
-  workflow_dispatch:
-    inputs:
-      candidate_sha: {...}
-      unit_definition_path: {...}
-      proof_kind: {...}
-      test_id: {...}

 permissions:
   contents: read
```

Two test files were updated to match:

- `scripts/audit/devgovTrustedWorkflow.test.ts` — added a regression test,
  _"exposes no standalone dispatch entry point -- workflow_call is the only trigger"_, asserting
  `workflow.on.workflow_call` is truthy, `workflow.on.workflow_dispatch` is `undefined`, and
  `Object.keys(workflow.on)` is exactly `['workflow_call']`.
- `scripts/audit/devgovOrchestration.test.ts` — the pre-existing assertion
  `expect(workflow.on.workflow_dispatch).toBeTruthy()` (describing this same attest workflow) was
  wrong after the fix and is changed to `.toBeUndefined()`. No other line in that file changed.

## No legitimate caller lost

Repo-wide search for references to `devgov-v0-attest.yml` found exactly one live invocation:
`devgov-v0-orchestrate.yml`'s `red` and `green` jobs, both `uses: ./.github/workflows/devgov-v0-attest.yml`
— a `workflow_call` reference, untouched by this fix. `devgov-v0.yml`'s `pull_request.paths` filter
also names the file, but only as a path trigger for its own unrelated validation job, not as a
caller of `workflow_dispatch`. `governance/devgov/units/*.json` and `scripts/dev-helpers/lib/unitLint.mjs`
reference `devgov-v0-attest` only as the trusted-execution **issuer identity** string (job/workflow
identity baked into signed attestations), which is independent of which trigger invoked the run.
No script, doc, or workflow in the repository depends on the removed `workflow_dispatch` entry
point.

## RED / GREEN proof design

- **RED** (`attest-workflow-call-only-trigger`, `required_head: base_sha`): reads the workflow file,
  runs positive controls first (file exists, `workflow_call:` present under `on:`), then asserts
  `workflow_dispatch:` is **not** a sibling key. At `base_sha` this assertion fails as expected
  (exit 1) because the standalone trigger is still present there — the valid RED.
- **GREEN (a)** — the identical structural check, `required_head: candidate_sha`, must exit 0: the
  standalone trigger is gone, `workflow_call` remains intact and well-formed.
- **GREEN (b)** (`attest-workflow-call-caller-not-lost`) — re-verifies `workflow_call` on the
  candidate, counts `devgov-v0-orchestrate.yml`'s `uses: ./.github/workflows/devgov-v0-attest.yml`
  references (must be ≥ 2, matching `red` and `green`), and checks that both touched test files
  carry the expected post-fix assertions (`toBeUndefined()` for `workflow_dispatch`, and the sole-key
  pin in `devgovTrustedWorkflow.test.ts`).
- **GREEN (c)** (`attest-workflow-regression-tests`) — runs
  `vitest run --config scripts/devgov/vitest.config.mjs scripts/audit/devgovTrustedWorkflow.test.ts scripts/audit/devgovOrchestration.test.ts`,
  scoped with `-t 'standalone dispatch entry point|keeps the attestation workflow reusable'` to the
  two tests this unit's change actually governs. See **Known, pre-existing, out-of-scope test
  failure** below for why this GREEN is deliberately scoped rather than running both files
  unfiltered.

All three GREEN commands exit `2` (harness fault, never a valid RED/GREEN) on any unexpected
exception, per this repository's exit-code contract (`0` property holds, `1` substantive violation,
`2` harness fault).

## Known, pre-existing, out-of-scope test failure (not fixed by this unit)

Running `scripts/audit/devgovOrchestration.test.ts` **unfiltered** at the candidate SHA fails one
test — _"dispatches the canonical gate instead of trying to reuse its OIDC identity"_ — because
`.github/workflows/devgov-v0-orchestrate.yml` line 190 reads
`gh run watch "$gate_run_id" --repo "$GITHUB_REPOSITORY" --exit-status` while the test expects the
substring `gh run watch "$gate_run_id" --exit-status` (no `--repo` flag in between). This was
verified, via `git stash` and a bare `vitest run` against `base_sha` content, to fail **identically
before this unit's change** — it is pre-existing drift in a **forbidden path** for this unit
(`devgov-v0-orchestrate.yml` belongs to the separate, not-yet-started
`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1`). This unit does not touch, mask, or claim to fix it; GREEN
(c) is scoped specifically to avoid folding that unrelated, pre-existing failure into this unit's own
proof. It remains open and is called out here so it is not lost.

## Non-claims

This unit does not:

- touch `.github/workflows/devgov-v0-gate.yml` or `.github/workflows/devgov-v0-orchestrate.yml`, or
  either file's own `workflow_dispatch` trigger — that conversion to `repository_dispatch` /
  default-branch-controller, plus the explicit `@main` pin on the attest hop, is
  `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1`'s separate, not-yet-started scope;
- fix the pre-existing `gh run watch --repo` assertion drift described above;
- change signing, `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`, the `devgov-attestation` environment gate, or
  the verifier trust policy;
- change `scripts/devgov/**`, the unit-definition schema, or any invariant pack;
- reopen or resequence Step 5 (F-01…F-14); F-10's structural-verification rebuild is separate,
  explicitly deferred work;
- claim this closes every workflow-trigger attack surface in the repository — only the one described
  above, on this one file.

## Finalization

This record remains CANDIDATE until the exact packaged candidate receives
`DEV-GOV-V0 / trusted-execution = success`, is merged with a merge commit pinned to that SHA,
merge-tree equality is verified, and a separate PROVEN record is admitted.
