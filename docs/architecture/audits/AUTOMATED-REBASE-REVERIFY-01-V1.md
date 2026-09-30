# AUTOMATED-REBASE-REVERIFY-01-V1

**Final state:** UNVERIFIED -- repaired per W1-VERIFY-DB's 2026-09-30 independent cold review of
candidate `b7ddef9f` (verdict `SOUND_WITH_CHANGES`), on Jimmy's GO. See §7 for the repair itself and
what it did and did not re-verify. Still not pushed. The repaired candidate has NOT yet had its own
independent cold review -- per Jimmy's own stated process, only a delta review (not a full one) is
required next, covering exactly this repair.

## 1. What this is

Implements §1 steps 1-7 of
`Claude outputs/merge-queue-automation-2026-09-30/AUTOMATED-REBASE-REVERIFY-DESIGN-2026-09-30.md`
(design COLD_VERIFIED/ACCEPT for §1-4, 2026-09-30, Jimmy's own cold review, third pass). Per
`feedback-design-verdict-does-not-inherit-to-implementation`, that design-level verdict does not
transfer here -- this candidate needs its own implementation → proof-unit → cold verification →
W1-VERIFY-DB routing → explicit push/merge/dispatch-go, same as any other unit.

- `scripts/dev-helpers/automated-rebase-reverify.mjs` -- steps 1-5 (staleness detection, locate
  prior-approved SHA, Phase 1 identity check, merge, base_sha bump, Phase 2 self-check, local
  RED/GREEN dry-run). Lives under `scripts/dev-helpers/`, not `scripts/devgov/`, because the latter
  is a controller-owned floor path (F-10, `CONTROLLER_OWNED_FLOOR_PATHS` in
  `scripts/devgov/devgov.mjs`) that no Dev-Gov unit may ever add to or modify.
- `.github/workflows/devgov-v0-rebase-reverify.yml` -- step 6 (RED/GREEN re-run + sign, in CI,
  `environment: devgov-attestation`) and step 7 (stop, post an evidenced PR comment). A new,
  separate file rather than a modified `devgov-v0-orchestrate.yml`: that file's own `gate:` job
  unconditionally dispatches `devgov-v0-gate.yml` immediately after `sign:` succeeds, with no input
  to stop earlier -- reusing it as-is would violate the design's own "never dispatches
  `devgov-v0-gate.yml`" rule regardless of the (already-fixed, see design doc correction) `--repo`
  defect that used to live in that job.
- `governance/devgov/units/automated-rebase-reverify-01-v1.json` -- this candidate's own proof-unit.

## 2. A correction made to the already-accepted design during implementation

While implementing step 6, `.github/workflows/devgov-v0-orchestrate.yml` was read directly (not
re-summarized from the design doc): its `sign:` job carries `environment: devgov-attestation` --
the same gate `evidence-gate` carries -- and only that job receives
`secrets.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`. The design doc's §1.6/§2 originally claimed signing
ran through "the existing, unrestricted signing mechanism (`devgov-v0-attest.yml`'s `execute` job
... no `environment:` gate at all)", which conflated the (genuinely unrestricted) RED/GREEN
*execution* job with the (environment-gated) *signing* job. Jimmy approved correcting the design
doc itself (2026-09-30) rather than leaving the record wrong; the correction does not change this
design's scope or safety conclusion -- JImMMbt approves exactly as many times (sign, then
evidence-gate) either way, same as today's fully-manual process.

A second, unrelated correction was also made: §0/§4's "open" orchestrator gate-dispatch `--repo`
defect was already fixed on `origin/main` on 2026-09-17 (`0b5155e5`/`ca27eaf6`), 13 days before the
design document was written. Not a currently-open defect; noted for the record only.

## 3. Proof-unit design

Three RED/GREEN pairs, each exercising the real exported functions from
`automated-rebase-reverify.mjs` (`phase1VerifyOriginalIdentity`, `phase2VerifyOwnEdit`,
`classifyStaleness`) against synthetic adversarial fixtures -- not a hand-copied reference
implementation:

1. **`phase1-rejects-pre-existing-base-sha-drift`** -- the exact circularity scenario the design's
   own second cold-review pass found (§2): a branch whose `base_sha` already drifted *before* the
   automation touched anything. Verified directly (see §4 below) that a naive single-phase
   "byte-identical except `base_sha`" check -- the collapsed approach the design explicitly
   rejected -- wrongly accepts this fixture, while `phase1VerifyOriginalIdentity` correctly rejects
   it with `STOP_NEW_REVIEW_REQUIRED`.
2. **`phase2-rejects-edit-disguised-as-base-sha-only`** -- an edit that changes `base_sha` *and*
   another field, the other half of the same defect class.
3. **`staleness-gate-excludes-conflicting-prs`** -- §1 scope gate: a `BEHIND` but `CONFLICTING` PR
   must never be treated as in-scope.

RED runs at `base_sha` (`740b2fdf`, where this file does not exist yet -- `import()` fails, proving
the repo has no protection against these scenarios before this candidate); GREEN runs at
`candidate_sha`. Each script uses the `V()`/`H()` exit-code split (`V` = exit 1, the property
genuinely does not hold; `H` = exit 2, harness/environment fault) with `blocked_exit_codes: [2]`,
matching this repo's own established convention (e.g.
`governance/devgov/units/lu-api-boundary-step4-v1.json`) -- added after `devgov-helper.mjs lint`
flagged its absence (DGL-020) on the first draft.

## 4. Local verification performed

All of the following ran against real local worktrees
(`C:\wt-automated-rebase-reverify-01`, most recently re-run at candidate
`aee374ce2ac9e96e75b59c9aefb25456c14d18a8` (the §7 repair commit) -- and identically, before that,
at `32b69914bdc0bd035dff3ffa66e0864c8c247109` and `0a5a4f1a7e07d772d8fbb3a841aa5dfc324e8720`;
`C:\wt-automated-rebase-reverify-01-base`, detached at `740b2fdfa1faffb19b922d4eaeb187ce492521cf`)
via the **real, unmodified controller** (`node scripts/devgov/devgov.mjs run-red` /
`run-green`), not a hand-rolled test harness:

| id | RED (base_sha) | GREEN (candidate_sha) |
| --- | --- | --- |
| phase1-rejects-pre-existing-base-sha-drift | FAIL (expected FAIL) | PASS |
| phase2-rejects-edit-disguised-as-base-sha-only | FAIL (expected FAIL) | PASS |
| staleness-gate-excludes-conflicting-prs | FAIL (expected FAIL) | PASS |
| empty-manifest-fails-closed | FAIL (expected FAIL) | PASS |
| merge-failure-classification | FAIL (expected FAIL) | PASS |

All 10/10 match their `expected_classification`. `devgov-helper.mjs lint` re-run clean at
`aee374ce` (0 errors; the remaining 5 DGL-022 warnings on the RED entries -- "path exists at
candidate but not base_sha" -- are the intentional, hint-blessed case: "ignore only if absence of
that artefact IS the property under test", which it is here).

Separately verified directly (scratch script, not part of the committed proof) that the *naive,
rejected* single-phase check really does wrongly accept the Phase-1 adversarial fixture, to avoid
asserting a defect class in the proof-unit's own commentary without having reproduced it.

## 5. What has NOT been verified (non-claims)

- **No CI execution.** `devgov-v0-rebase-reverify.yml` has never run. Its `red:`/`green:` matrix
  jobs (calling the real, shared `devgov-v0-attest.yml`) and its `sign:` job (environment-gated,
  needs `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`, unavailable to this session) are unexercised.
- **No real PR.** `scripts/dev-helpers/automated-rebase-reverify.mjs`'s `gh`/`git` I/O layer
  (`detectStaleness`, `locatePriorApprovedSha`, the actual merge/push/dispatch path) has not been
  run end-to-end against a live stale PR. Only the pure decision functions
  (`phase1VerifyOriginalIdentity`, `phase2VerifyOwnEdit`, `classifyStaleness`) have real, executed
  proof.
- **Not independently reviewed.** This audit was written by the same session that implemented the
  candidate. Per this program's own standing rule, it is not a substitute for W1-VERIFY-DB's
  independent cold review, and this candidate must not be treated as verified until that happens.
- Nothing has been pushed to `origin`. `git ls-remote` will not show this branch.

## 6. Base bump

Not applicable -- this is the candidate's first version, not a rebase-reverify of itself.

## 7. Repair per W1-VERIFY-DB (2026-09-30)

W1-VERIFY-DB's independent cold review of `b7ddef9f` (5 parallel dimension reviewers + 1 synthesis
adjudicator, all fresh agents with no memory of the implementing session) returned
`SOUND_WITH_CHANGES`: no blocker against the design's hard safety invariant, but 5 confirmed major
findings. Jimmy's GO (2026-09-30) authorized fixing all of them plus 3 additional hardening items
he judged cheap and in-scope for a fail-closed tool, explicitly ruling out further scope expansion:

1. **Missing `invariant-packs:` job + false comment.** Added, identical in shape to
   `devgov-v0-orchestrate.yml`'s own job of the same name (confirmed present at this candidate's
   own `base_sha`, `740b2fdf`). The file's comment previously claimed the missing `gate:` job was
   the only structural difference from `orchestrate.yml`; corrected.
2. **Hardcoded "Phase 1/2: PASS" in the PR comment, never actually checked by the workflow.** Added
   a new `reverify-phases:` job that independently re-derives both results from real git history at
   the three SHAs the `repository_dispatch` payload names -- `old_candidate_sha`, a new
   `pre_merge_tip_sha` field (added to the payload, was missing before), and `candidate_sha` itself
   -- using the candidate's own real `phase1VerifyOriginalIdentity`/`phase2VerifyOwnEdit` functions
   against independently-fetched (`git show`) bytes, never trusting the dispatching script's local
   run. `red`/`green`/`sign` all now depend on this job; the PR comment prints its outputs instead
   of literal text.
3. **Unpaginated `gh api .../commits/{sha}/status` lookup.** Switched to the array-shaped, genuinely
   paginatable `/commits/{sha}/statuses` (plural) endpoint with `--paginate` and `per_page=100`,
   defensively parsing either output shape `gh`'s pagination might produce. **Found and fixed a
   second, real bug while testing this against the live API**: `gh api` silently switches to
   `POST` the moment any `-f`/`-F` flag is present unless `--method GET` is passed explicitly --
   without it, this call hit the *create*-a-status endpoint and failed with a 422. Reproduced the
   failure live, then the fix, against `repos/JbmbAb/Milj-beslut-V1.2/commits/740b2fdf.../statuses`
   before trusting it.
4. **Unbounded, untimed, non-retried per-commit `gh api` loop.** Added a `MAX_COMMITS_TO_WALK` (200)
   cap that fails closed with `STOP_TOO_MANY_COMMITS_TO_WALK` instead of walking forever; added a
   bounded exponential-backoff retry (`withRetry`, 3 attempts) around the status lookup; added a
   default timeout (`DEFAULT_TIMEOUT_MS`, 60s) to every `git`/`gh` child process via the shared
   `run`/`runAllowFail` helpers, with a longer explicit timeout (150s) for the `devgov.mjs`
   RED/GREEN invocation specifically, since its own internal default is already 120s.
5. **Wrong `scripts/devgov/...` path references** in the workflow's header comment and PR-comment
   body -- corrected to the real `scripts/dev-helpers/...` path throughout.
6. **`old_base_sha`/`pr_number` not shape-validated** (unlike `candidate_sha`/`old_candidate_sha`).
   Added regex checks for both (plus the new `pre_merge_tip_sha`) in the workflow's
   "Validate client_payload shape" step, and a matching `--pr` positive-integer check in the
   script's own `parseArgs`.
7. **Empty RED/GREEN manifest would vacuously report local PASS.** Added
   `assertNonEmptyManifest()`, called before the local dry-run; fails closed with
   `STOP_EMPTY_PROOF_MANIFEST` if either list is empty. New RED/GREEN pair
   `empty-manifest-fails-closed`.
8. **Merge failures uniformly mislabeled "conflict."** Added `classifyMergeFailure()`, which
   inspects `git merge`'s actual stderr for real conflict markers (`CONFLICT`, `Automatic merge
   failed`) before choosing `STOP_MERGE_CONFLICT` vs. the new `STOP_MERGE_FAILED`. New RED/GREEN
   pair `merge-failure-classification`.

Also removed the dead `execFileSync` import (note-level finding).

**Two defects in this repair itself, found by the implementing session before the delta review was
launched (both fixed in the same candidate that goes to review, so reviewers see the corrected
version -- disclosed here rather than silently folded in):**

- **Item 8 was wrong as first written.** `git merge` writes its `CONFLICT` / `Automatic merge
  failed` lines to **stdout**, not stderr (reproduced live in a scratch repo: real conflict, exit 1,
  stderr empty). `main()` passed only `mergeResult.stderr` to `classifyMergeFailure`, so every real
  conflict would have been filed as `STOP_MERGE_FAILED`. The proof-unit did not catch this because
  it only exercises the pure function with a hand-written string. Fixed: `main()` now classifies on
  stdout + stderr combined. **Known remaining gap:** the integration itself (which stream
  `main()` hands the classifier) still has no executed proof; the live scratch-repo probe above is
  evidence, not a committed test.
- **`reverify-phases:` executed candidate code.** As first written it imported
  `phase1VerifyOriginalIdentity`/`phase2VerifyOwnEdit` from the *candidate's* checkout, so a
  candidate could ship a modified function that always answers OK -- contradicting the trust model
  `plan:`/`sign:` already follow ("checkout exact candidate without executing candidate code").
  Fixed: the verification logic is now imported from a protected default-branch `controller/`
  checkout; the candidate is only ever read as git data (`git -C candidate show`), including the
  post-edit unit definition (previously read via `fs` from a payload-supplied path with no
  containment check). Also anchored Phase 2's `base_sha` comparison to reality: because the
  expected new `base_sha` is read from the file itself in CI, that comparison alone was vacuous; the
  job now additionally requires it to be a 40-hex SHA that is an ancestor of the candidate (i.e. the
  base was actually merged). The job's embedded Node step was extracted from the real YAML and run
  against synthetic git histories: honest base bump passes; an edit that also tampers with `unit`
  fails Phase 2; a `base_sha` never merged fails; a branch drifted before the automation ran fails
  Phase 1. This is a local simulation of the step's logic, not a GitHub Actions run.

**Local verification of the repair:** all 7 exported pure functions re-tested with fixtures
(`phase1VerifyOriginalIdentity`, `phase2VerifyOwnEdit`, `classifyStaleness`, plus the 2 new
`assertNonEmptyManifest`, `classifyMergeFailure`) -- all correct. The proof-unit now declares 5
RED/GREEN pairs (2 new); `devgov-helper.mjs lint` re-run clean (0 errors, same 5 intentional,
hint-blessed DGL-022 warnings). Full 5-pair (10-entry) RED/GREEN regression re-run through the
real, unmodified controller against the repaired candidate `aee374ce2ac9e96e75b59c9aefb25456c14d18a8`
-- 10/10 match `expected_classification`; see the updated table in §4.

**What this repair explicitly did NOT do** (no scope expansion, per Jimmy's own instruction): no
real PR was exercised, nothing was pushed, `reverify-phases:`'s own CI-side logic (the embedded
Node script inside the new workflow job) was written carefully but has -- like the rest of
`main()`'s I/O orchestration -- never executed in real GitHub Actions; that remains true after this
repair exactly as it was before it, and is unrelated to what this repair fixed. No new RED/GREEN
pair was added for `locatePriorApprovedSha`'s pagination/retry/timeout logic, since it is I/O-heavy
and not meaningfully unit-testable without mocking `gh` -- it remains reviewed-but-unproven code,
now with a live-API-verified bug fix behind it (see item 3) rather than an untested assumption.
