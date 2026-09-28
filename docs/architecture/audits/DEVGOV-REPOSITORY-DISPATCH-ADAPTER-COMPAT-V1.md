# DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1 — CANDIDATE

**Status:** CANDIDATE / NOT YET PROVEN
**Frozen base:** `cf33cc1318b4505ccbf57d6296136b99c41fdee1`
**Unit:** `DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1`
**Classification:** mandatory immediate-next companion unit to
`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1` ("C"), per C's own closed audit doc's Finalization
section and the owner's sequencing.

## Purpose / vulnerability context recap

C (`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1`, merged PR #176+#177) converted
`.github/workflows/devgov-v0-gate.yml` and `.github/workflows/devgov-v0-orchestrate.yml` from
candidate-selectable `workflow_dispatch` (ref + `inputs.*`, GitHub resolves the workflow
definition from whichever `ref` the caller supplies) to `repository_dispatch` (`event_type` +
`client_payload`, no `ref` field at all in the REST payload — GitHub always resolves and executes
the **default branch's** copy). This closed F-11, a real, live-exploitable vulnerability: a
candidate branch could no longer forge a trusted-execution commit status by dispatching its own
modified copy of the controller workflow. See
`docs/architecture/audits/DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1.md` for the full F-11 writeup —
that file is a closed, already-PROVEN historical record and is not edited here.

C's own audit doc, in its **"packages/mps-control-plane — dormant contract mismatch, not a live
break"** section, disclosed a real, deliberately-deferred consequence found during C's own
forensic pass (and independently re-confirmed by this session's own falsification pass before
implementation): `packages/mps-control-plane`'s multi-agent dispatch/correlation code
(`GitHubDevGovDispatchAdapter.ts`, `GitHubRunCorrelation.ts`) was entirely `workflow_dispatch`-shaped
and no longer matched `devgov-v0-orchestrate.yml`'s real trigger contract. C's own doc states this
plainly: "GitHubDevGovDispatchAdapter and RepositoryDispatchCorrelator remain workflow_dispatch-shaped
but are not currently production-wired. Their migration is required immediately after this unit as
a separate companion unit (DEVGOV-REPOSITORY-DISPATCH-ADAPTER-COMPAT-V1) before any production
wiring of that adapter is permitted." This unit is that companion unit.

Independently re-verified at this unit's own base (`cf33cc13…`), by grepping the whole repository:
`new GitHubDevGovDispatchAdapter(...)` and `new RepositoryDispatchCorrelator(...)` occur **only** in
`tests/unit/control-plane/*.test.ts`. `DevGovReconciler.ts` imports only a _type_
(`DevGovWorkflowAvailabilityPort`, plus a type-only import of `RepositoryDispatchCorrelator`) from the
adapter/correlator modules and calls only `correlator.poll(...)`/`correlator.findRun(...)` — never
`correlator.dispatch(...)` — so it needed zero edits. No `server/**` or other production entrypoint
instantiates either class. This remains a _dormant contract mismatch_, not a live break: nothing in
production called the old, now wire-incompatible shape before this unit, and nothing does after it.

## Migration — before/after dispatch shape and correlation dimensions

### `packages/mps-control-plane/src/multi-agent/GitHubRunCorrelation.ts`

- The low-level REST port was renamed, not just re-bodied, to stay honest about what changed:
  `GitHubWorkflowDispatchPort` → `GitHubRepositoryDispatchPort`. Its `dispatchWorkflow(input: {
workflow, ref, inputs })` method became `dispatchRepositoryEvent(input: { eventType,
clientPayload })`, matching GitHub's real REST contract for this event type: `POST
/repos/{owner}/{repo}/dispatches` with body `{event_type, client_payload}` — no `ref`, no
  `inputs`, no per-workflow targeting field exists in that payload at all. `getRefSha(ref)` is kept
  unchanged: the pre-dispatch commit identity is still needed for correlation even though the
  dispatch call itself carries no `ref`.
- `PendingCorrelation`/`CorrelationFile`: `inputs` renamed to `clientPayload`; a new required
  `eventType: string` field was added so a crash-recovered process can replay the exact same
  `dispatchRepositoryEvent` call. The on-disk schema literal
  `'multi-agent-github-run-correlation-v1'` was bumped to
  `'multi-agent-github-run-correlation-v2'` everywhere it appears (`CorrelationFile.schemaVersion`,
  the `EMPTY` const, and `FileCorrelationStore.read()`'s validation check) — the durable shape
  genuinely changed (renamed field + new required field), so an old v1 file now fails closed via
  the existing `CorrelationStoreError` instead of silently deserializing with
  `clientPayload`/`eventType` left `undefined`. This is consistent with the file's own established
  fail-closed philosophy, and low-cost: nothing production-wired persists a real v1 file today
  (independently re-confirmed above).
- `matchCandidates()`: `run.event === 'workflow_dispatch'` → `run.event === 'repository_dispatch'`.
  Its doc comment now states plainly that `repository_dispatch` has no `ref` field at all, so
  `ref`/`headBranch` here means "the branch these runs are expected to execute on" (the
  repository's own default branch, matched for defense-in-depth/consistency), never a
  caller-selected value. This was already true in practice for this adapter's real usage — its
  only caller always hardcodes `protectedRef: 'main'` — so no disambiguating power is lost by this
  reframing.
- `RepositoryDispatchCorrelator.dispatch(input)`'s public input gained `eventType` and renamed
  `inputs` → `clientPayload`; `workflow` and `ref` were **kept** on both the input and the
  persisted record — they remain genuinely useful (`workflow` scopes `listRuns(workflow, ref)` and
  store identity; `ref` remains a real consistency check against `run.headBranch`). Only the
  literal REST call built from them changed shape.
- `attemptExternalDispatch(record)`'s external call became
  `this.dispatchPort.dispatchRepositoryEvent({ eventType: record.eventType, clientPayload:
record.clientPayload })`. Everything around this call — the `dispatchAttemptedAt` marker
  persisted _before_ this line, the `AWAITING_RUN` transition persisted after, and all
  crash-restart logic in `dispatch()`/`resolveUncertain()`/`poll()`/`pollAllPending()`/`findRun()`
  — is byte-for-byte untouched. This is the load-bearing argument for crash/idempotency semantics
  being preserved (see below): only the literal external call and one string comparison in
  `matchCandidates()` changed; the state machine around them
  (`UNCERTAIN_DISPATCH → dispatchAttemptedAt → AWAITING_RUN →
CORRELATED/AMBIGUOUS_CORRELATION/CORRELATION_TIMEOUT`, never-blind-redispatch, horizon-based
  retry) did not.
- Class/interface-level doc comments referencing "workflow_dispatch" were updated to
  "repository_dispatch" throughout this file for accuracy (still 204 No Content, still not
  idempotent, still no idempotency-key mechanism — same operational hazards, different wire shape).

### `packages/mps-control-plane/src/multi-agent/GitHubDevGovDispatchAdapter.ts`

- `GitHubDevGovDispatchAdapterOptions` gained `eventType?: string`; the constructor defaults it to
  `'devgov-v0-orchestrate'`, verified byte-for-byte against `devgov-v0-orchestrate.yml`'s real
  `on.repository_dispatch.types: [devgov-v0-orchestrate]` (read from the live workflow file, not
  guessed), stored alongside the existing `workflow`/`protectedRef` fields.
- The `dispatch()` method's correlator call now passes `eventType: this.eventType` and
  `clientPayload: {...}` in place of `inputs: {...}`; the payload keys themselves
  (`candidate_sha`, `unit_definition_path`) are unchanged — already verified byte-for-byte against
  `devgov-v0-orchestrate.yml`'s documented `github.event.client_payload` keys.
- Class-level doc comment updated from "workflow_dispatch endpoint" to "repository_dispatch
  endpoint" — accuracy pass only, no behavioral change.

`DevGovReconciler.ts` is **not** listed in this unit's `allowed_paths` and was not touched: it
calls only `correlator.poll(...)`/`correlator.findRun(...)`, never `correlator.dispatch(...)`, and
imports only types from the adapter/correlator modules — confirmed by re-reading the file before
scoping this unit, not assumed.

## Test-file changes

All five files under `tests/unit/control-plane/*.test.ts` that construct or exercise
`RepositoryDispatchCorrelator`/`GitHubDevGovDispatchAdapter` were updated. The mechanical transform
applied at every call site: `implements GitHubWorkflowDispatchPort` →
`implements GitHubRepositoryDispatchPort`; `dispatchWorkflow` method/key →
`dispatchRepositoryEvent`; every `.dispatch({dispatchKey, workflow, ref, inputs: {...}})` call
gained `eventType` and renamed `inputs` → `clientPayload`; every `ObservedWorkflowRun` fixture's
default `event: 'workflow_dispatch'` → `event: 'repository_dispatch'` (explicit non-default
overrides such as `{event: 'push'}`, which intentionally test rejection of a foreign event, were
left unchanged — they remain meaningful either way).

| File                                         | Nature of change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Semantic risk                                                                                                                                                                                                                                                                                                                                                                                  |
| :------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MultiAgentGitHubRunCorrelationV1.test.ts`   | Heaviest file: import, `DispatchPort` fake, `validRun()` default event, 10 `corr.dispatch({...})` call sites (mechanical, via one `replace_all` on the shared literal), 6 raw `createIfAbsent({...})` record literals in the crash-window tests (also needed `clientPayload`/`eventType` since `PendingCorrelation` now requires them — not covered by the "10 dispatch sites" framing alone, added after re-reading the file), `ThrowingDispatch` fake + its test title, one other test title's prose | None: every assertion (status transitions, `dispatchPort.calls` length, never-redispatch, pagination, ambiguity, eventual consistency) is unchanged in substance — only the fixture shapes they are built from changed.                                                                                                                                                                        |
| `MultiAgentDispatchAdaptersV1.test.ts`       | Import, `DispatchPort` fake, and the single most important assertion: the exact-shape `toEqual({eventType, clientPayload})` on `dispatchPort.calls[0]`, replacing the old `toEqual({workflow, ref, inputs})`                                                                                                                                                                                                                                                                                           | This `toEqual` (exact-shape, not partial-match) is itself proof that no `ref`/`workflow`/`inputs` field leaks into the real wire call. All other tests in this file (mailbox idempotency, lease reservation, missing-workflow/pre-activation/proof-mismatch/path-traversal denials) use the correlator only via the shared fake and needed no behavioral change.                               |
| `MultiAgentDevGovReconcilerV1.test.ts`       | Import, `run()` fixture event, `DispatchPort` fake (no-op method rename), two `corr.dispatch({...})` sites (`correlatedTo()` helper and the ambiguous-correlation test)                                                                                                                                                                                                                                                                                                                                | Contract-only: this file's real coverage is `DevGovReconciler`'s authority/state-machine logic, entirely orthogonal to wire shape. Every reconciler-outcome assertion is untouched in meaning.                                                                                                                                                                                                 |
| `MultiAgentDevGovAuthorityBindingV1.test.ts` | No named port-type import (structural typing): two inline structurally-typed fakes' `dispatchWorkflow` key renamed to `dispatchRepositoryEvent`, two `corr.dispatch({...})` sites, one `run()` fixture default event                                                                                                                                                                                                                                                                                   | This file's actual purpose (proving a hostile-but-successful commit status can never substitute for an authoritative proof) is completely independent of dispatch wire shape — pure compile-time plumbing.                                                                                                                                                                                     |
| `MultiAgentCrashRetryIdempotencyV1.test.ts`  | Import; only 2 of 10 numbered cases touch this surface: case 3 (`Dispatch implements GitHubRepositoryDispatchPort`, `observedRun()` event, one `correlator.dispatch({...})` call) and case 9 (one structurally-typed literal's method key renamed, never actually calls `.dispatch()` since `workflowExists()` returns `false` first)                                                                                                                                                                  | Case 3's real guarantee (ambiguity is reported, never guessed) is a crash/idempotency-adjacent property and keeps holding unchanged — `resolveUncertain()`'s ambiguity logic is untouched; only fixtures changed. Cases 1,2,4,5,6,7,8,10 (mailbox/lease/outbox/coordinator crash-retry mechanics) do not reference the correlator/adapter at all and needed zero changes (confirmed via grep). |

## Crash / idempotency semantics — preserved, not weakened

The state machine (`UNCERTAIN_DISPATCH → dispatchAttemptedAt (persisted before the network call) →
AWAITING_RUN → CORRELATED/AMBIGUOUS_CORRELATION/CORRELATION_TIMEOUT`), the never-blind-redispatch
guard in `dispatch()`, and the horizon-based uncertain-retry logic in `resolveUncertain()` are all
byte-for-byte unchanged by this unit. Only two things changed: (1) the literal shape of the one
external call in `attemptExternalDispatch()`, and (2) the one string comparison in
`matchCandidates()`. Every crash-window test in `MultiAgentGitHubRunCorrelationV1.test.ts` (tests
C1, C2, the eventual-successful-correlation-after-restart test, the ambiguity-after-restart test,
the no-blind-duplicate-dispatch test, and the beyond-horizon-retry test) and
`MultiAgentCrashRetryIdempotencyV1.test.ts` case 3 pass unchanged in substance under the new
contract — verified by running the full suite (see RED/GREEN proof design below), not assumed.

The one durable-format change — `inputs` → `clientPayload` plus a new required `eventType` field on
`PendingCorrelation` — is itself guarded by the schema-version bump
(`multi-agent-github-run-correlation-v1` → `-v2`): an old v1 file on disk now fails closed via
`CorrelationStoreError` rather than silently loading with `clientPayload`/`eventType` `undefined`,
which would otherwise have been a silent idempotency/crash-recovery hazard for any process that
had a real v1 file on disk. As documented above, no production-wired process persists a real v1
file today, so this is a defensive versioning of a format that has no live instances to migrate —
consistent with this file's own established fail-closed design, not a new risk.

## FA-02 note (owner-ruled, low-risk, not code-fixed)

During C's own falsification pass, `devgov-v0-orchestrate.yml`'s `uses:
.../devgov-v0-attest.yml@main` reference was found to be a mutable-branch pin with no
`concurrency:` guard between its red/green matrix legs. The owner ruled this low-risk and
reliability-only — not a security issue — and it was explicitly **not** code-fixed. It is recorded
here, in this unit's own audit doc, only because C's own audit doc
(`docs/architecture/audits/DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1.md`) is already merged and
closed and cannot be amended after the fact. This unit makes **no change** related to _this_
(C's inherited) FA-02 finding — `.github/workflows/**` remains forbidden for that purpose. (This
unit's own, separate FA-02 finding from its own cold falsification pass — a concurrent-dispatch
cross-match bug, unrelated to this note and coincidentally sharing the same label — is fixed via
one owner-authorized line in `devgov-v0-orchestrate.yml`; see "Round 2 repair" below.)

## FA-05 correction (K-56, owner ruling relayed 2026-09-28)

FA-05 was originally framed, during C's own cold falsification pass, as a possible alternate
dispatch route via `.github/workflows/smoke-integrations.yml`'s missing top-level `permissions:`
block.

**Corrected characterization**, per the owner's verified ruling (K-56, 2026-09-28): this
repository's `default_workflow_permissions` is `read`. A workflow with no own `permissions:` block
— `smoke-integrations.yml`, which uses no secrets — therefore runs with a **read-only**
`GITHUB_TOKEN` and cannot call `POST /repos/{owner}/{repo}/dispatches`, which requires
`contents: write` (confirmed by reading `devgov-v0-orchestrate.yml`'s own gate job, which
explicitly declares `permissions: { actions: read, contents: write }` for exactly that reason). The
described attack therefore needs write access the attacker would not have via that specific route,
and anyone who already holds write access could fire a `repository_dispatch` directly anyway — no
new privilege escalation is introduced by the missing block.

Defense-in-depth already in place, independent of this correction: the orchestrator always executes
main's own copy (`repository_dispatch` resolves only the default branch — there is no `ref` field
to redirect it); `deny_absent` requires the candidate on its declared branch; real signing still
requires the `devgov-attestation` environment's approval/OIDC binding (the producer cannot
self-approve; every promotion waits on a protected reviewer for that environment); and the
trusted-execution status is posted only after a real gate run. A bare `repository_dispatch` firing
can therefore, at most,
request an _honest_ evaluation — it can never forge a result.

**Conclusion, stated plainly: FA-05 is hygiene** — a workflow missing an explicit `permissions:`
block is best practice regardless of exploitability through this specific route — **not an open
security vulnerability.** This correction is recorded here, referencing C's doc
(`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1.md`) by name for the original framing, per instruction
not to edit that closed/PROVEN file.

## Explicit non-claim — the 8-workflow `permissions:` micro-unit is separate, future scope

This unit does **not** add `permissions: { contents: read }` (or any other explicit `permissions:`
block) to the eight workflows currently missing one: `smoke-integrations.yml`, `ci.yml`,
`build-postgres-image.yml`, `deploy-gcp.yml`, `deploy-staging.yml`, `mimers-sovereign.yml`,
`staging-e2e-proof.yml`, `staging-proof-gate.yml`. That is a separate, not-yet-started micro-unit
(sequenced, per the owner's relayed program order, as its own scope or as a micro-unit directly
after `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1`/"D" in the owner's stated ordering), out of scope
here. `.github/workflows/**` remains forbidden for this purpose (no `permissions:` blocks added
anywhere). Separately and narrowly, this unit's own `allowed_paths` was owner-authorized to include
exactly one line in `devgov-v0-orchestrate.yml` (a `run-name:` addition) to close this unit's own
FA-02 cross-match finding — see "Round 2 repair" below; every other file under
`.github/workflows/**` remains untouched and forbidden.

## RED / GREEN proof design

Five checks, all dependency-free `node -e` inline programs following this repository's established
`V(msg)`/`H(msg)`/`DGL_OK` convention (`V` exits 1 — `DGL_VIOLATION`, a real finding; `H` exits 2 —
`DGL_HARNESS_ERROR`, the proof itself is broken; `blocked_exit_codes: [2]` on every command so a
harness bug is never mistaken for a passing/failing candidate) — mirroring C's own `V`/`H`/`DGL_OK`,
block-isolation, positive-control, `blocked_exit_codes:[2]` idiom exactly. Four are mandatory; one
(schema-version bump) is recommended and included. Four checks share an id across
`required_red` (FAIL @ `base_sha`) / `required_green` (PASS @ `candidate_sha`); one
(`control-plane-repository-dispatch-regression-tests`) is GREEN-only, for the same reason C's own
analogous regression-test checks are GREEN-only: at `base_sha` the test suite is
self-consistently `workflow_dispatch`-shaped (old code, old fixtures), so it already exits 0
there — a real-suite-pass check cannot be a meaningful RED signal. The fifth check
(`dispatch-correlator-candidate-sha-cross-match-guard`) was added in the round-2 repair (see
below) to close the FA-02 concurrent-dispatch cross-match gap.

- **`dispatch-wire-call-repository-dispatch-shape`** (RED @ base_sha expects FAIL, GREEN @
  candidate_sha expects PASS) — isolates `RepositoryDispatchCorrelator.attemptExternalDispatch(...)`'s
  method body by brace-depth scanning from `private async attemptExternalDispatch(` to its matching
  closing brace (the same "isolate the exact block, then reason only inside it" technique C used
  for YAML `on:` blocks, translated from indentation-scanning to brace-depth-scanning for
  TypeScript), then isolates the argument object literal of the
  `this.dispatchPort.dispatchRepositoryEvent({...})` (or, at base_sha,
  `dispatchWorkflow({...})`) call the same way. Direct top-level keys of that object literal are
  extracted by tracking brace/paren/bracket depth per character (a line's key counts only when the
  depth _at the start of that line_ is exactly 1 relative to the object literal's own opening
  brace) — this is depth-based, not a fixed-indentation-width regex, so it is robust to this
  file's actual nesting depth (class → method → statement → object literal) rather than assuming a
  fixed number of spaces. Asserts the extracted key set is exactly `{eventType, clientPayload}` and
  that `ref`/`inputs`/`workflow` are _not_ present. **Positive control** (required): the identical
  isolation+extraction logic is run against an in-script synthetic fixture containing a fake
  `attemptExternalDispatch` method with `this.dispatchPort.dispatchWorkflow({ workflow: 'x', ref:
'y', inputs: {} })`, asserting the detector correctly reports `ref`/`inputs`/`workflow` present
  and `eventType`/`clientPayload` absent on that fixture — proving the detector can catch the bad
  pattern, not just pass on the good one.
- **`dispatch-correlator-event-predicate-repository-dispatch`** (RED @ base_sha expects FAIL, GREEN
  @ candidate_sha expects PASS) — isolates `function matchCandidates(...)`'s body the same
  brace-depth way, then asserts the isolated body contains the exact literal substring
  `run.event === 'repository_dispatch'` and does _not_ contain `run.event === 'workflow_dispatch'`.
  **Positive control**: the same substring checks applied to a synthetic one-line fixture
  `"return run.event === 'workflow_dispatch';"` are asserted to flag it correctly.
- **`correlation-store-schema-version-bumped`** (recommended; RED @ base_sha expects FAIL, GREEN @
  candidate_sha expects PASS) — counts occurrences of the literal strings
  `multi-agent-github-run-correlation-v1` and `multi-agent-github-run-correlation-v2` in the file
  text; asserts zero `v1` occurrences and at least one `v2` occurrence. **Positive control**: the
  same regexes are asserted to match a synthetic one-line literal of each form exactly once, so the
  regex itself is proven non-vacuous before it is trusted to prove an absence. Cheap and meaningful:
  proves the durable file-format change was deliberately versioned rather than silently
  reinterpreted, so an old v1 file on disk fails closed instead of loading with
  `clientPayload`/`eventType` silently `undefined`.
- **`control-plane-repository-dispatch-regression-tests`** (GREEN-only, PASS @ candidate_sha) —
  `child_process.spawnSync('npx'/'npx.cmd', ['vitest', 'run', '--config', 'vitest.config.ts',
'--project', 'unit', <all five tests/unit/control-plane/*.test.ts files that exercise this
surface>], { stdio: 'inherit', shell: <win>, timeout: 240000 })`, requiring exit 0; `H()` on
  spawn failure, `V()` on nonzero exit. This is the genuinely behavioral proof: it exercises the
  real `RepositoryDispatchCorrelator`/`GitHubDevGovDispatchAdapter` classes end-to-end (not just
  their source text), including the exact-shape `toEqual({eventType, clientPayload})` assertion in
  `MultiAgentDispatchAdaptersV1.test.ts` and every crash/idempotency/ambiguity guarantee in
  `MultiAgentGitHubRunCorrelationV1.test.ts` and `MultiAgentCrashRetryIdempotencyV1.test.ts` case 3
  — and, after the round-2 repair, the new FA-02 two-concurrent-candidates regression test (see
  below) in `MultiAgentGitHubRunCorrelationV1.test.ts`.
- **`dispatch-correlator-candidate-sha-cross-match-guard`** (RED @ base_sha expects FAIL, GREEN @
  candidate_sha expects PASS; added in the round-2 repair) — isolates `function matchCandidates(...)`'s
  body the same brace-depth way, then asserts the isolated body contains both
  `.clientPayload.candidate_sha` and `.displayTitle.includes(`. **Positive control**: the same
  substring checks are run against an in-script synthetic "good" fixture (contains both) and a
  synthetic "bad" fixture (contains neither), asserting the detector reports presence/absence
  correctly on each. At `base_sha` neither literal exists in `matchCandidates()` at all (the
  function does not reference `displayTitle` or `candidate_sha` in any form there), so this is a
  real, non-vacuous RED.

All five checks were run locally against both `base_sha` (`cf33cc13…`, by transiently swapping
`GitHubRunCorrelation.ts` to its `git show cf33cc13:...` content, running the checks, then
restoring the candidate content and confirming the restored file byte-matches the candidate diff)
and the candidate worktree before packaging — using the exact `node -e "<script>"` command and
`args` text stored in `governance/devgov/units/devgov-repository-dispatch-adapter-compat-v1.json`,
not a hand-copied approximation of it:

| Check                                                     | @ base_sha                                                                | @ candidate_sha                                        |
| :-------------------------------------------------------- | :------------------------------------------------------------------------ | :----------------------------------------------------- |
| `dispatch-wire-call-repository-dispatch-shape`            | FAIL (exit 1) — keys found: `workflow, ref, inputs`                       | PASS (exit 0) — keys found: `eventType, clientPayload` |
| `dispatch-correlator-event-predicate-repository-dispatch` | FAIL (exit 1) — no `repository_dispatch` comparison found                 | PASS (exit 0)                                          |
| `correlation-store-schema-version-bumped`                 | FAIL (exit 1) — 3 `v1` occurrences, 0 `v2`                                | PASS (exit 0) — 0 `v1` occurrences, 3 `v2`             |
| `dispatch-correlator-candidate-sha-cross-match-guard`     | FAIL (exit 1) — `hasCandidateShaLookup=false, hasDisplayTitleCheck=false` | PASS (exit 0)                                          |
| `control-plane-repository-dispatch-regression-tests`      | (GREEN-only, not run at base_sha)                                         | PASS (exit 0) — 5 files, 86 tests, all passing         |

Every positive control passed on both runs (i.e. the detectors correctly flagged the synthetic
bad-pattern fixtures), so none of the four FAIL results above are vacuous.

## packages/mps-control-plane — dormant contract mismatch CLOSED

`GitHubDevGovDispatchAdapter` and `RepositoryDispatchCorrelator` are now `repository_dispatch`-shaped,
matching `devgov-v0-orchestrate.yml`'s real trigger contract exactly (verified: `eventType` default
`'devgov-v0-orchestrate'` matches the live workflow's `repository_dispatch.types`; `client_payload`
keys `candidate_sha`/`unit_definition_path` match the live workflow's
`github.event.client_payload.*` references). They are still **not production-wired** — re-verified
independently at this unit's own candidate: `new GitHubDevGovDispatchAdapter(...)` and `new
RepositoryDispatchCorrelator(...)` still occur only in `tests/unit/control-plane/*.test.ts`; no
`server/**` or other production entrypoint instantiates either class. This unit closes the _dormant
contract mismatch_ C's audit doc disclosed; it does not, and was never scoped to, wire the adapter
into production.

## Non-claims

This unit does **not**:

- wire `GitHubDevGovDispatchAdapter`/`RepositoryDispatchCorrelator` into production, or claim it is
  now safe to do so — that remains separate, future scope;
- touch `scripts/devgov/**`, `governance/devgov/schema/**`,
  `governance/devgov/invariant-packs/**`, or any `server/**`, `prisma/**`, `src/**`,
  `scripts/ops/**`, `scripts/import/**` path, or any file under `.github/workflows/**` **other
  than** the one owner-authorized `run-name:` line in `devgov-v0-orchestrate.yml` (see "Round 2
  repair" below) — every other workflow file remains forbidden and untouched;
- add `permissions: { contents: read }` (or any other explicit `permissions:` block) to the eight
  workflows currently missing one — that is a separate, not-yet-started micro-unit, out of scope
  here (see the explicit non-claim section above);
- amend C's own closed/merged audit docs
  (`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1.md`,
  `DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1-PROVEN.md`) or unit definitions
  (`devgov-protected-controller-dispatch-v1*.json`,
  `devgov-attest-standalone-dispatch-closure-v1*.json`) — all are `FORBIDDEN_PATHS` for this unit
  and were only read, never written;
- reopen or resequence Step 5 (F-01…F-14), the `DEVGOV-INVARIANT-PACKS-V1` line of work, or any
  W1/W2/LU-related track;
- push a branch, open a PR, or fire a real GitHub Actions dispatch — this unit was committed
  locally only, per its own task instructions (no push/PR/dispatch performed by this session).

## Round 2 repair (2026-09-28): concurrent-dispatch cross-match closed; correlator class renamed

A cold falsification pass of the round-1 candidate (commit `a8b08893`) found the wire-shape and
event-predicate migration sound (this pass's own FA-01/FA-03/FA-05 not confirmed as issues) but
two real, confirmed defects, fixed here as a new commit on top of `a8b08893` (not a rewrite of it).
**Note the label collision:** this pass's own "FA-02" finding below is unrelated to, and numbered
independently of, the "FA-02 note" section earlier in this document (that one is C's inherited
finding about `devgov-v0-orchestrate.yml`'s mutable `@main` pin — a different falsification pass,
a different issue, a coincidentally identical label).

### FA-02 (this pass): concurrent repository_dispatch calls could be cross-bound — CLOSED

**The bug.** `matchCandidates()`'s binding dimensions — `workflow`, `headBranch`/`ref`, `headSha`,
`event`, and a creation-time window — were carried over from the round-1 migration unchanged in
substance, just repointed at `repository_dispatch`. Under the old `workflow_dispatch` shape this
was safe: each dispatch could carry a distinct, candidate-selected `ref`, and even when two
dispatches shared a ref, `headSha` could still legitimately differ from one dispatch to the next.
Under `repository_dispatch` neither is true any more: the event's own REST payload has no `ref`
field at all, and GitHub always resolves and executes the **same** default-branch tip regardless of
which call triggered the run — so `headSha` is now **identical** across every concurrent dispatch of
this workflow. None of the five old dimensions encodes which dispatch call actually produced a
given run. Concretely: dispatch A (`candidate_sha = X`) then dispatch B (`candidate_sha = Y`) close
together; GitHub creates `Run_A` first; record B polls, sees only `Run_A`, every one of its five
dimensions matches, and record B gets **permanently** bound to `Run_A` — which actually belongs to
X, not Y — because `poll()` short-circuits once a record is `CORRELATED` and never revisits it. This
is a real hazard specifically because concurrent dispatch (multiple units gating at once) is the
whole point of a multi-agent orchestrator; it was not a theoretical edge case.

**The fix.** `devgov-v0-orchestrate.yml` gained a `run-name:` field —
`DEV-GOV orchestrate ${{ github.event.client_payload.candidate_sha }} unit=${{
github.event.client_payload.unit_definition_path }}` — mirroring the pattern
`devgov-v0-gate.yml` already uses for its own `run-name:`. This makes GitHub's own `display_title`
for the resulting run carry the exact `candidate_sha` that dispatch call sent — the one piece of
API-visible, per-run data that **does** vary across concurrent dispatches even though `headSha` does
not. `ObservedWorkflowRun` gained a `displayTitle: string` field (sourced from the same
`display_title` the observer port already lists runs from), and `matchCandidates()` now requires
`run.displayTitle.includes(record.clientPayload.candidate_sha)` in addition to the original five
dimensions; a record whose `clientPayload` carries no `candidate_sha` string can never match at all
(fail-closed, consistent with this file's existing fail-closed philosophy — it does not fall back to
matching everything). This closes the hole **structurally**: the fix removes the shared-ambiguity
condition itself (no two concurrent runs for different candidates can have the same `displayTitle`),
it does not merely narrow the window in which the old bug could fire.

**Proof.** A new `MultiAgentGitHubRunCorrelationV1.test.ts` case ("L. FA-02: two concurrent
repository_dispatch calls for DIFFERENT candidate_sha values...") reproduces the exact scenario:
two dispatches on one correlator/store/observer, sharing `refShaAtDispatch`, for two different
`candidate_sha` values; only the run belonging to the first candidate has surfaced; the test asserts
the second record is **not** incorrectly bound to it (`AWAITING_RUN`, not a wrong `CORRELATED`), then
that it binds correctly to its own run once that run appears, and that the first record's own
binding is unaffected. This test was manually confirmed to **fail** against the pre-fix
`matchCandidates()` (`resolvedB.status` came back `'CORRELATED'` — the exact wrong-bind failure mode
— instead of the expected `'AWAITING_RUN'`) before the fix, and to pass after it. A new
`dispatch-correlator-candidate-sha-cross-match-guard` RED/GREEN check pair was added to this unit's
own governance JSON (static brace-depth isolation of `matchCandidates()`, asserting presence of both
`.clientPayload.candidate_sha` and `.displayTitle.includes(` at candidate_sha and absence of both at
base_sha — see the RED/GREEN proof design table above). `.github/workflows/devgov-v0-orchestrate.yml`
was added to this unit's own `allowed_paths` for exactly this one line; every other path under
`.github/workflows/**` remains untouched and forbidden.

### FA-04 (this pass): `WorkflowDispatchCorrelator` / `WorkflowDispatchCorrelatorOptions` renamed

The round-1 migration correctly renamed the port interface (`GitHubWorkflowDispatchPort` →
`GitHubRepositoryDispatchPort`), its method (`dispatchWorkflow` → `dispatchRepositoryEvent`), the
event-predicate string, the on-disk schema version, and the `inputs` → `clientPayload` field — but
left the correlator class and its options type unrenamed, despite being otherwise
`repository_dispatch`-shaped throughout. `WorkflowDispatchCorrelator` → `RepositoryDispatchCorrelator`
and `WorkflowDispatchCorrelatorOptions` → `RepositoryDispatchCorrelatorOptions`, with every reference
updated: `GitHubDevGovDispatchAdapter.ts`'s constructor parameter type and doc comment,
`DevGovReconciler.ts`'s two typed fields (this file is now listed in this unit's own `allowed_paths`
for exactly this rename — it needed zero other edits, confirmed by re-reading it), every touched
`tests/unit/control-plane/*.test.ts` file, and every occurrence in this audit doc itself (this is a
pure rename — no behavioral change). The two occurrences that remain unchanged are in C's own
closed/merged audit docs (`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1.md`,
`DEVGOV-PROTECTED-CONTROLLER-DISPATCH-V1-PROVEN.md`), which are `FORBIDDEN_PATHS` for this unit and
correctly describe the shape that existed when they were written.

## Finalization

This record remains CANDIDATE until the exact packaged candidate receives
`DEV-GOV-V0 / trusted-execution = success`, is merged with a merge commit pinned to that SHA,
merge-tree equality is verified, and a separate PROVEN record is admitted.
