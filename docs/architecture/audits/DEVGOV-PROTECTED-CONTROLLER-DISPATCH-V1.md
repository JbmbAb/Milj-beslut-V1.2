# DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `b3d1a93bb4b1f7142dc3263ace694768973b0122`
**Unit:** `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1`
**Classification:** BLOCKING security closure, owner-authorized 2026-09-25 (Option 1, unchanged scope).

## Purpose

Close F-11: remove the last candidate-selectable `workflow_dispatch` entry point on the two
workflows that together publish the canonical `DEV-GOV-V0 / trusted-execution` commit status —
`.github/workflows/devgov-v0-gate.yml` and `.github/workflows/devgov-v0-orchestrate.yml` — by
converting both to `repository_dispatch`-only triggers, and pin the orchestrator's `uses:` reference
into `devgov-v0-attest.yml` to an explicit `@main` ref so the one remaining reusable-workflow hop
cannot be redirected either.

## Vulnerability (F-11)

At `base_sha` (`b3d1a93b…`), both `devgov-v0-gate.yml` and `devgov-v0-orchestrate.yml` declared
`workflow_dispatch` as their sole top-level trigger. `workflow_dispatch` resolves the _workflow
definition it runs_ — including every step, including the file's own `on:` block and any in-file
guard step — from whichever `ref` the caller supplies to the dispatch call (`gh workflow run … --ref
<ref>` / `POST /repos/{owner}/{repo}/actions/workflows/{id}/dispatches` with a `ref` field). Both
files' only defense was an in-file bash step, `Require protected default-branch
controller`/`orchestrator`, comparing `github.ref` to the repository's default branch — but that
guard lives inside the same file a candidate can edit in their own branch. An attacker with push +
Actions-dispatch access (no admin, no secrets) can push a branch, delete that one guard step in their
own copy, and dispatch it: GitHub runs their copy, whose `evidence-gate` job can then forge a
`DEV-GOV-V0 / trusted-execution = success` commit status for any `candidate_sha`, using nothing but
the default `github.token`'s existing `statuses: write` permission. No signing key is needed because
the forged run _is_ the canonical gate identity as far as the branch-protection status check is
concerned. This was confirmed live-reproducible against the pre-fix code by anyone with push +
dispatch access to this repository.

`repository_dispatch` closes this structurally rather than defensively: its REST payload
(`event_type`, optional `client_payload`) carries **no `ref` or branch field at all**. GitHub always
resolves and executes a `repository_dispatch`-triggered workflow from the copy of the file committed
on the repository's default branch — there is nothing in the triggering event for a candidate to
redirect. See **RED / GREEN proof design** below for why this is verified structurally, not by
grepping for the string `repository_dispatch`.

## Fix

1. **`devgov-v0-gate.yml`** — `on:` no longer declares `workflow_dispatch`; its sole trigger is now
   `repository_dispatch: { types: [devgov-v0-gate] }`. Every `${{ inputs.X }}` reference (24
   occurrences across `run-name`, `env:`, `if:`, and `with:` blocks) became
   `${{ github.event.client_payload.X }}`. `repository_dispatch` has no per-key
   `required`/`type`/`description` metadata the way `workflow_dispatch.inputs` did, so a comment block
   above `on:` documents the expected `client_payload` keys (`candidate_sha`,
   `unit_definition_path`, `red_run_id`, `green_run_id`, `attestation_run_id`,
   `attestation_run_ids`) for documentation parity. GitHub Actions' expression coercion turns a
   missing `github.event.client_payload.X` into the same empty string an unset optional
   `workflow_dispatch` input already produced, so every existing `[ -n "$X" ]` / `== ''` / `!= ''`
   guard in this file keeps working unchanged; `test "${#CANDIDATE_SHA}" -eq 40` already fails closed
   on an empty/malformed `candidate_sha`, so `repository_dispatch` only moves that enforcement from
   "GitHub rejects the API call before a run starts" to "the run starts and fails at this step" — both
   fail closed, neither lets a forged status through.
2. **`devgov-v0-orchestrate.yml` top-level trigger** — same conversion:
   `repository_dispatch: { types: [devgov-v0-orchestrate] }` replaces `workflow_dispatch`. All 14
   `inputs.candidate_sha` / `inputs.unit_definition_path` references (plan, red/green `with:`, gate,
   state, and the artifact name) became `github.event.client_payload.*`.
3. **`devgov-v0-orchestrate.yml`'s `gate` job** — its dispatch step now issues
   `gh api --method POST repos/$GITHUB_REPOSITORY/dispatches -f event_type='devgov-v0-gate' -F
'client_payload[...]=...'` instead of `gh workflow run devgov-v0-gate.yml --ref
"$DEFAULT_BRANCH" -f ...` (the `--ref`/`$DEFAULT_BRANCH` selection is gone entirely —
   `repository_dispatch` has nothing to select). Its polling step's query filter moved from
   `event=workflow_dispatch` to `event=repository_dispatch`. Its job `permissions` moved from
   `{ actions: write, contents: read }` to `{ actions: read, contents: write }`: `actions: read` is
   still required to poll/find the dispatched run; the write capability moved from `actions` (no
   longer needed — nothing calls `gh workflow run` any more) to `contents` (required by
   `POST /repos/{owner}/{repo}/dispatches`). The already-correct
   `gh run watch "$gate_run_id" --repo "$GITHUB_REPOSITORY" --exit-status` line is unchanged (see the
   **pre-existing drift** note below).
4. **`devgov-v0-orchestrate.yml`'s `red`/`green` jobs** — `uses: ./.github/workflows/devgov-v0-attest.yml`
   became `uses: JbmbAb/Milj-beslut-V1.2/.github/workflows/devgov-v0-attest.yml@main` in both jobs.
   This is load-bearing, not cosmetic: a `workflow_call`-invoked job's own `github.ref`/`github.sha`
   reflect the top-level triggering ref, so a relative `./...` `uses:` reference resolves from
   whatever ref `orchestrate.yml` itself was invoked from. Pinning to an explicit `@main` closes that
   one-hop substitution path regardless of how `orchestrate.yml` is triggered. `devgov-v0-attest.yml`
   itself (a forbidden path for this unit) is untouched — only the reference to it changed shape.
5. **Tests, README** — see below.

### Test updates

`scripts/audit/devgovOrchestration.test.ts`:

- The gate-workflow assertions now expect `workflow.on.workflow_dispatch` to be `undefined` and
  `workflow.on.repository_dispatch` to be truthy with `types` equal to `['devgov-v0-gate']`.
- The orchestrator's `Object.keys(workflow.on)` assertion now expects `['repository_dispatch']` with
  `types` equal to `['devgov-v0-orchestrate']`.
- `workflow.jobs.red.uses` / `workflow.jobs.green.uses` now expect the pinned `@main` string exactly.
- `gate.permissions` now expects `{ actions: 'read', contents: 'write' }`.
- The dispatch-step assertions now expect the `repos/$GITHUB_REPOSITORY/dispatches` /
  `event_type='devgov-v0-gate'` / `client_payload[attestation_run_id]=$ATTESTATION_RUN_ID` markers and
  explicitly assert `gh workflow run devgov-v0-gate.yml` and `event=workflow_dispatch` are **absent**.
- The polling-query assertion now expects `event=repository_dispatch`.
- **The one pre-existing, out-of-scope test failure `DEVGOV-ATTEST-STANDALONE-DISPATCH-CLOSURE-V1`
  explicitly left for this unit** — `'dispatches the canonical gate instead of trying to reuse its
OIDC identity'` expected `gh run watch "$gate_run_id" --exit-status` (no `--repo` flag) while the
  real file already had `gh run watch "$gate_run_id" --repo "$GITHUB_REPOSITORY" --exit-status` — is
  fixed here by correcting the test's expected string to match the already-correct workflow code (the
  workflow line itself is unchanged by this unit).
- The artifact-name assertion now expects `devgov-orchestration-${{ github.event.client_payload.candidate_sha }}`.

`scripts/audit/devgovTrustedWorkflow.test.ts`:

- The gate-workflow describe block's `ref: ${{ inputs.candidate_sha }}` / `run-id: ${{
inputs.red_run_id }}` / `run-id: ${{ inputs.green_run_id }}` assertions now expect the
  `github.event.client_payload.*` form (these three assertions were not called out by name in the
  originating task description but were discovered, by actually running the suite against the edited
  workflow, to be additional pre-existing assertions on `devgov-v0-gate.yml`'s content that the
  `inputs.*` → `client_payload.*` rewrite also affects).
- A new test, _"exposes no candidate-selectable dispatch entry point on the protected controller
  workflows"_, asserts `workflow.on.workflow_dispatch` is `undefined` and `workflow.on.repository_dispatch`
  is truthy, with `Object.keys(workflow.on)` equal to exactly `['repository_dispatch']`, for **both**
  `devgov-v0-gate.yml` and `devgov-v0-orchestrate.yml` — the regression assertion the owner's task
  explicitly asked for, matching the pattern already used for `devgov-v0-attest.yml` in the prior
  unit.
- `governance/devgov/units/README.md`: contains no literal occurrence of `workflow_dispatch`; its
  dispatch-mechanism prose is trigger-agnostic and remains accurate. One sentence was added noting the
  controller/orchestrator dispatch trigger is `repository_dispatch`, not `workflow_dispatch`, so a
  future reader understands why `--ref`/`-f`-style manual dispatch no longer applies to these two
  files.
- `governance/devgov/units/devgov-orchestrator-explicit-repo-dispatch-v1.json` and
  `devgov-orchestrator-explicit-repo-watch-v1.json` were read and checked, not assumed: both are
  closed historical proof records pinned to their own already-superseded `base_sha`/branch, and
  nothing in this repository replays a `governance/devgov/units/*.json` unit's `required_red`/
  `required_green` commands outside a live DEV-GOV orchestration run of that specific unit
  (`npm run devgov:test`, the only thing `devgov-v0.yml`'s lint job runs, is
  `vitest run --config scripts/devgov/vitest.config.mjs`, whose `include` is
  `scripts/audit/devgov*.test.ts` only). Per this repository's own convention
  (`governance/devgov/units/README.md`: historical records are "rejected... rather than implicitly
  upgraded"), neither file was edited. `devgov-orchestrator-explicit-repo-watch-v1.json`'s
  `gh run watch "$gate_run_id" --repo "$GITHUB_REPOSITORY" --exit-status` marker still matches the
  unchanged line in `devgov-v0-orchestrate.yml`.

## Live attack design vs. packaged structural proof — division of labor

The packaged `required_red`/`required_green` proof below is pure static analysis over committed file
bytes plus one filesystem-scoped mutation test in a temp directory: no network calls, no real GitHub
dispatch. It is safe to run repeatedly and automatically inside the trusted execution sandbox, which
is why it belongs in `required_red`/`required_green`. The genuinely live version of the attack — a
real throwaway branch with the guard step deleted, a real `workflow_dispatch` attempt that succeeds
pre-fix and is rejected (no such trigger exists) post-fix — is out of band: performed personally by
the repository owner via the `gh` CLI, outside this packaged proof, as agreed.

## RED / GREEN proof design

Five checks, all dependency-free `node -e` inline programs following this repository's established
`V(msg)`/`H(msg)`/`DGL_OK` convention (`V` exits 1 — `DGL_VIOLATION`, a real finding; `H` exits 2 —
`DGL_HARNESS_ERROR`, the proof itself is broken; `blocked_exit_codes: [2]` on every command so a
harness bug is never mistaken for a passing/failing candidate).

- **`dispatch-trigger-surface-exact`** (RED @ base_sha expects FAIL, GREEN @ candidate_sha expects
  PASS) — isolates each file's top-level `on:` block by line-scanning from `/^on:\s*$/` to the next
  top-level (`/^\S/`) line (the same block-isolation technique the prior unit's RED already uses for
  `devgov-v0-attest.yml`), so a `workflow_dispatch` string anywhere else in the file (a comment, a
  step name) cannot produce a false result. Asserts `repository_dispatch:` is present and
  `workflow_dispatch:` is absent as _direct child keys of that isolated block_, for both files
  independently, with an internal positive control on the isolation regex before it is trusted to
  prove an absence.
- **`dispatch-no-ref-selection-surface`** (RED @ base_sha expects FAIL, GREEN @ candidate_sha expects
  PASS) — goes past the "contains the string `repository_dispatch`" bar the owner explicitly rejected
  as insufficient. It isolates the `repository_dispatch:` sub-block by the same indentation
  line-scanning technique one level deeper, enumerates its _direct child keys_, and asserts the only
  one present is `types` (parsed from its inline flow-sequence form without a YAML library, staying
  dependency-free); asserts every entry is a plain opaque string with no `.`, `/`, or `refs/`
  substring; and separately scans the whole `repository_dispatch:` body for any of the ref/branch/path
  selector keys GitHub recognizes on _other_ trigger types (`ref`, `branch`, `sha`, `branches`,
  `branches-ignore`, `tags`, `tags-ignore`, `paths`, `paths-ignore`) — none of which have any meaning
  in the documented `repository_dispatch` payload schema. This demonstrates the proof reasoned about
  the event schema itself (no ref field exists anywhere in a `repository_dispatch` payload to smuggle
  a selector into), not merely that the YAML happens to contain a magic word.
- **`dispatch-attest-uses-pinned-ref`** (RED @ base_sha expects FAIL, GREEN @ candidate_sha expects
  PASS) — isolates the `red:`/`green:` job bodies in `orchestrate.yml` by the same block-isolation
  technique and asserts both `uses:` values equal the pinned `@main` form by exact string equality
  (not `.includes`), that the relative `./...` form does not appear anywhere in the file, and that the
  pinned form appears exactly twice — generalizing and tightening the prior unit's
  `attest-workflow-call-caller-not-lost` check (which only required `≥ 2` occurrences of the relative
  form) to require the pinned form specifically.
- **`dispatch-mutated-copy-inert-off-default-branch`** (GREEN-only, PASS @ candidate_sha) — two parts
  in one script. **(a)** Reads the real candidate `gate.yml`/`orchestrate.yml`, writes byte-identical
  copies into a throwaway `os.tmpdir()` location, and programmatically strips every step whose `name`
  starts with `Require protected default-branch` (modeling an attacker deleting the guard in their own
  branch). It then re-parses the mutated copy's `on:` block using the same Check-1 logic and asserts
  it is **unchanged** — proving structurally, not by assertion alone, that guard-step deletion (a
  `jobs.*.steps` edit) and the top-level `on:` trigger declaration are syntactically disjoint parts of
  the file, so deleting the guard cannot resurrect a ref-selectable entry point. It logs the reasoning
  explicitly: because `repository_dispatch` has no ref field for GitHub to resolve this throwaway copy
  from (Check 2), this mutated copy is never the copy GitHub would execute regardless of whether its
  guard steps exist — guard deletion is inert _by construction_, not merely "still caught by a guard
  that happens to still be there." **(b)** A positive control, so the proof cannot be vacuous:
  constructs a synthetic fixture workflow string with `on: { workflow_dispatch: {...} }` and no guard
  step, and asserts Check 1's own detection logic correctly flags it (`hasWorkflowDispatch === true`)
  — proving the checks in this unit can actually catch the real vulnerability pattern when present,
  which is the concrete answer to "merely testing that the YAML contains `repository_dispatch` is not
  sufficient proof": these checks are shown capable of failing on the bad pattern, not just passing on
  the good one.
- **`dispatch-workflow-regression-tests`** (GREEN-only, PASS @ candidate_sha) —
  `child_process.spawnSync('npx'/'npx.cmd', ['vitest', 'run', '--config',
'scripts/devgov/vitest.config.mjs', 'scripts/audit/devgovOrchestration.test.ts',
'scripts/audit/devgovTrustedWorkflow.test.ts'], { stdio: 'inherit', timeout: 180000 })`, requiring
  exit 0 — same pattern as the prior unit's `attest-workflow-regression-tests`, now covering this
  unit's test edits including the previously-failing `gh run watch … --repo` assertion (now fixed).

All five checks were run locally against both `base_sha` (`b3d1a93b…`, via `git show` into a
throwaway worktree shape) and the candidate worktree before packaging: every RED command observed
`FAIL` (exit 1) at `base_sha` and `PASS` (exit 0) at the candidate; both GREEN-only checks observed
`PASS` at the candidate.

## packages/mps-control-plane — dormant contract mismatch, not a live break

`packages/mps-control-plane/src/multi-agent/GitHubDevGovDispatchAdapter.ts` sends `ref` + `inputs`
per `workflow_dispatch` semantics, and `GitHubRunCorrelation.ts`
(`packages/mps-control-plane/src/multi-agent/GitHubRunCorrelation.ts:156`) requires
`run.event === 'workflow_dispatch'`. Both are `workflow_dispatch`-shaped and will need migrating once
`orchestrate.yml` moves to `repository_dispatch`. This unit independently verified, by grepping the
whole repository, that `new GitHubDevGovDispatchAdapter(...)` and `new WorkflowDispatchCorrelator(...)`
occur **only** in `tests/unit/control-plane/*.test.ts`; `DevGovReconciler.ts` imports only a _type_
(`DevGovWorkflowAvailabilityPort`) from the adapter module, and `new DevGovReconciler(` likewise
occurs only in test files. No `server/**`, `scripts/ops/**`, or other production entrypoint
instantiates either class. `packages/**` is a forbidden path for this unit and was not touched.

**GitHubDevGovDispatchAdapter and WorkflowDispatchCorrelator remain workflow_dispatch-shaped but are
not currently production-wired. Their migration is required immediately after this unit as a separate
companion unit (DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1) before any production wiring of that
adapter is permitted.**

This is a _dormant contract mismatch_, not "broken-on-main": nothing live breaks when this unit merges,
because nothing production-wired calls the adapter yet. It must still be closed immediately as the
next unit — not deferred indefinitely — and is sequenced as the owner's mandatory next step
immediately after this unit reaches PROVEN.

## Non-claims

This unit does **not**:

- touch `.github/workflows/devgov-v0-attest.yml`, `.github/workflows/devgov-v0.yml`,
  `scripts/devgov/**`, `governance/devgov/schema/**`, `governance/devgov/invariant-packs/**`, or any
  `packages/**`, `server/**`, `src/**`, `components/**`, `services/**`, `integrations/**`,
  `prisma/**`, `scripts/ops/**`, or `scripts/import/**` path;
- migrate `GitHubDevGovDispatchAdapter` or `WorkflowDispatchCorrelator` to `repository_dispatch`
  semantics — that is `DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1`'s separate, mandatory,
  immediately-next scope;
- wire `GitHubDevGovDispatchAdapter`/`WorkflowDispatchCorrelator` into production, or claim it is safe
  to do so before that companion unit lands;
- reopen or resequence Step 5 (F-01…F-14) or the DEVGOV-INVARIANT-PACKS-V1 line of work;
- push a branch, fire a real GitHub Actions dispatch, or otherwise perform the live version of the F-11
  attack — that is performed personally by the repository owner via the `gh` CLI, outside this
  packaged proof, per the division of labor described above;
- claim this closes every workflow-trigger attack surface in the repository — only the
  candidate-selectable-ref surface on `devgov-v0-gate.yml` and `devgov-v0-orchestrate.yml`, and the
  one relative-`uses:` substitution path into `devgov-v0-attest.yml` from `devgov-v0-orchestrate.yml`;
- edit `governance/devgov/units/devgov-orchestrator-explicit-repo-dispatch-v1.json` or
  `devgov-orchestrator-explicit-repo-watch-v1.json` — both were read and confirmed to be closed
  historical records that nothing in CI replays outside a live orchestration run of their own unit.

## Finalization

This record remains CANDIDATE until the exact packaged candidate receives
`DEV-GOV-V0 / trusted-execution = success`, is merged with a merge commit pinned to that SHA,
merge-tree equality is verified, and a separate PROVEN record is admitted. `W1`
(current-main reconciliation) waits until both this unit and
`DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1` are finalized, per the owner's sequencing.
