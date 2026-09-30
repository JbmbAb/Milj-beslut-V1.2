# AUTOMATED-REBASE-REVERIFY-01-V1

**Final state:** UNVERIFIED. Two independent W1-VERIFY-DB rounds have reviewed this candidate and both
returned changes; every finding of both rounds is dispositioned in §7. The repair of the second round
(verified candidate `6a849b61de6d0e720eeda0562970aaeae282d852`) has **not** itself been independently
re-reviewed. Not pushed. Nothing here has run in GitHub Actions or against a real PR -- see §5 before
reading any "verified" below.

## 1. What this is

Implements §1 steps 1-7 of
`Claude outputs/merge-queue-automation-2026-09-30/AUTOMATED-REBASE-REVERIFY-DESIGN-2026-09-30.md`
(design COLD_VERIFIED/ACCEPT for §1-4, 2026-09-30, Jimmy's own cold review, third pass). Per
`feedback-design-verdict-does-not-inherit-to-implementation`, that design-level verdict does not
transfer here -- this candidate needs its own implementation → proof-unit → cold verification →
W1-VERIFY-DB routing → explicit push/merge/dispatch-go, same as any other unit.

- `scripts/dev-helpers/automated-rebase-reverify.mjs` -- steps 1-5: staleness detection, locate the
  prior-approved SHA, Phase 1, merge, base_sha bump, Phase 2, a local lineage preflight and a local
  RED/GREEN dry-run. Lives under `scripts/dev-helpers/`, not `scripts/devgov/`, because the latter is a
  controller-owned floor path (F-10, `CONTROLLER_OWNED_FLOOR_PATHS` in `scripts/devgov/devgov.mjs`)
  that no Dev-Gov unit may ever add to or modify. All decision logic is in exported pure functions so
  each has an executed proof: `phase1VerifyOriginalIdentity`, `phase2VerifyOwnEdit`,
  `bumpBaseShaInText`, `classifyStaleness`, `assertNonEmptyManifest`, `classifyMergeFailure`,
  `hasCurrentGreenDevGovStatus`, `parseControllerRun`, `evaluateDryRun`, `reverifyLineage` (10
  functions, plus the `STOP` and `DEVGOV_STATUS_CONTEXT` constants).
- `.github/workflows/devgov-v0-rebase-reverify.yml` -- step 6 (RED/GREEN re-run + sign, in CI,
  `environment: devgov-attestation`) and step 7 (stop, post an evidenced PR comment). A new, separate
  file rather than a modified `devgov-v0-orchestrate.yml`: that file's own `gate:` job unconditionally
  dispatches `devgov-v0-gate.yml` immediately after `sign:` succeeds, with no input to stop earlier --
  reusing it as-is would violate the design's "never dispatches `devgov-v0-gate.yml`" rule. Its
  complete list of structural differences from `orchestrate.yml` is in the file's header.
- `governance/devgov/units/automated-rebase-reverify-01-v1.json` -- this candidate's own proof-unit
  (10 RED + 10 GREEN).

## 2. Corrections made to the already-accepted design during implementation

While implementing step 6, `.github/workflows/devgov-v0-orchestrate.yml` was read directly: its `sign:`
job carries `environment: devgov-attestation` -- the same gate `evidence-gate` carries -- and only that
job receives `secrets.DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`. The design doc's §1.6/§2 originally claimed
signing ran through "the existing, unrestricted signing mechanism (`devgov-v0-attest.yml`'s `execute`
job ... no `environment:` gate at all)", which conflated the (genuinely unrestricted) RED/GREEN
*execution* job with the (environment-gated) *signing* job. Jimmy approved correcting the design doc
itself (2026-09-30). The correction does not change the design's scope or safety conclusion -- JImMMbt
approves exactly as many times (sign, then evidence-gate) either way.

Also corrected in the design doc: §0/§4's "open" orchestrator gate-dispatch `--repo` defect was already
fixed on `origin/main` on 2026-09-17 (`0b5155e5`/`ca27eaf6`), before the design was written.

## 3. Proof-unit design, and what it does and does not prove

Ten RED/GREEN pairs. Each GREEN calls the real exported function(s) and asserts **both directions**:
legitimate input is accepted and each adversarial input is rejected (a first version only asserted
rejection, and a reviewer showed three of its GREENs passed with an always-reject stub).

| pair | what the GREEN asserts |
| --- | --- |
| phase1-rejects-drift-and-accepts-identical | identical bytes accepted; `base_sha` drift, other-field drift and a pure reformat rejected |
| phase2-accepts-exact-edit-and-rejects-everything-else | the exact base_sha edit accepted; extra-field, wrong value, re-serialisation and no-op rejected |
| staleness-gate-scope | only BEHIND + MERGEABLE in scope; CLEAN, CONFLICTING, UNKNOWN each stop with the right reason |
| empty-manifest-fails-closed | every empty/missing RED/GREEN shape fails closed; a non-empty manifest passes |
| merge-failure-classification | both git conflict markers classified as conflict; unrelated-history, dirty-tree (incl. a file named `conflict-policy.md`) and empty output are not |
| status-newest-per-context-decides | the NEWEST status for the context decides (newest failure under an older success = not approved), other contexts ignored |
| controller-exit-code-tolerance | the controller envelope is read at exit 0/2/4; empty, non-JSON, envelope-less and spawn-error output is a harness error |
| dry-run-evaluation | correct dry-run passes; failing GREEN, unexpected RED, missing results, custom `expected_classification`, each empty side stop |
| base-sha-single-line-bump | exactly one top-level line changes; CRLF and no-trailing-newline preserved; nested `base_sha` untouched; 0 or 2 matches and bad SHAs fail closed |
| lineage-accepts-honest-rebase-rejects-forgeries | real scratch git histories: the honest rebase accepted; 14 forged/drifted inputs rejected (see §7) |

**Every RED is a "file not found" RED.** At `base_sha` (`740b2fdf`) the script does not exist, so each
RED fails at the `import()` in its wrapper before any logic runs. That proves only that the capability
does not exist before this candidate, not that any semantic property fails -- which is inherent to a
unit that adds a new file. `devgov-helper.mjs lint` flags this on every RED (DGL-022); the warnings are
**accepted, not suppressed, and not "hint-blessed"**: the lint hint's exemption applies when the
artefact's absence *is* the property under test, which is not the case here. (An earlier revision of
this document said otherwise; that was wrong.) The lineage RED was additionally rewritten to run no git
at all, because lint forbids git in a RED (DGL-021). Consequently **the GREEN entries carry all the
proof**, and their strength was tested by mutation: 23 sabotaged copies of the script (always-accept /
always-reject stubs, dropped checks, loosened conditions, unanchored regexes, one per decision the
lineage function makes) were each run against all ten bodies; **23/23 were caught by the intended
body.** A first mutation run caught 19/23 and exposed four weaknesses in the tests themselves (a
symlink case that was really stopped by Phase 2 rather than the mode check, an `old_base_sha` case
stopped by a later check, an empty-GREEN-only gap, a stale mutant pattern); all four were fixed and the
run repeated. Lint is 0 errors; the warnings are 10x DGL-022 (above) and 1x DGL-040 on the lineage
GREEN, a heuristic false positive: violations there are recorded and `V()` is called only after the
`finally` has removed the sandbox.

## 4. Local verification performed

Against real local worktrees (`C:\wt-automated-rebase-reverify-01` at
`6a849b61de6d0e720eeda0562970aaeae282d852`; a disposable worktree detached at
`740b2fdfa1faffb19b922d4eaeb187ce492521cf`, removed afterwards), via the real, unmodified controller
(`node scripts/devgov/devgov.mjs run-red` / `run-green`):

- **All 20 proof entries matched `expected_classification`**: 10/10 RED observed `FAIL` (controller exit
  2), 10/10 GREEN observed `PASS` (exit 0).
- **The script's real dry-run I/O path was executed against the real controller.**
  `runManifestEntries -> parseControllerRun -> evaluateDryRun` (run from a scratch copy of the script with
  one appended `export` line, so the candidate itself was untouched; run with `cwd` = `C:\`) processed
  10 RED + 10 GREEN in 29 s, verdict `ok`. A GREEN deliberately run against the wrong HEAD produced exit
  4 / `DENIED_GOVERNANCE`, which `evaluateDryRun` reported as `STOP_CANDIDATE_FAILURE` rather than
  crashing. This is the path whose exit-code handling was the blocker found by round 2.
- **The workflow's `reverify-phases` step** was extracted from the real YAML and executed against a
  synthetic git history with `gh` intercepted by a preload: the honest rebase produced the three PASS
  outputs and the exact `gh api` argv verified live; a newest-failure status, a tampered bump and an
  `old_base_sha` mismatch each failed the step.
- **The `plan` job's shape validation** was extracted and run under bash with hostile values: a
  multi-line `pr_number` (`12\n--flag`) and a multi-line SHA, which the earlier `grep`-based check let
  through, now fail, as do leading-zero/over-long PR numbers, upper-case SHAs, `..`/absolute/space paths.
- **Live GitHub API** (read-only): `gh api --method GET --paginate --jq '.[]' -f per_page=100
  repos/JbmbAb/Milj-beslut-V1.2/commits/{sha}/statuses` returns NDJSON; a PR head
  (`8e8af6682646cf7805bb7e8586804afa74e807a0`) returned a success `DEV-GOV-V0 / trusted-execution` newer
  than an earlier pending; a commit with no statuses returns empty output. The claim that omitting
  `--method GET` makes `gh api -f ...` hit the create-a-status handler (HTTP 422 "State is not included
  in the list") was reproduced live by the round-1 implementer against `740b2fdf` and by a round-2
  reviewer with a bogus SHA; these were write-shaped requests rejected by validation, nothing was
  created, and a second round-2 reviewer declined to repeat it for that reason.
- **Git behaviour**: `git merge` writes its `CONFLICT` / `Automatic merge failed` lines to **stdout**
  with empty stderr (scratch repo, git 2.54); reproduced by the implementer and independently by a
  reviewer, including modify/delete, unrelated-histories and dirty-tree refusals.

## 5. What has NOT been verified (non-claims)

- **No GitHub Actions run of any kind.** Nothing in `devgov-v0-rebase-reverify.yml` has executed on a
  runner. Only pieces extracted from it were run locally (above), on Windows. The Linux runner, the
  `realpath` containment in `plan:`/`sign:`, the reusable-workflow calls into `devgov-v0-attest.yml`, and
  the environment-gated `sign:` job (which needs `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`, unavailable to
  this session) are unexercised.
- **Unverified assumption: the evidence gate will accept attestations produced by this workflow.**
  Reading `devgov-v0-gate.yml` and the controller found no check pinning the attestation run to
  `devgov-v0-orchestrate.yml` (artifacts are fetched by `run-id`; acceptance rests on the signature, the
  hard-coded `workflow_ref` = `devgov-v0-attest.yml@main`, and the run id, all of which this workflow
  reproduces -- it calls the same `attest.yml` and signs in the same run). That is a reading, not a
  test; the first real use must confirm it.
- **`main()`'s git/gh orchestration has never run end-to-end against a real PR.** What *has* now run for
  real is the dry-run path (§4). Still unexecuted: `detectStaleness`, `locatePriorApprovedSha`'s history
  walk and cap, the merge/commit/push/dispatch sequence, the temp-worktree lifecycle, and `main()`'s
  hand-off of git's **stdout+stderr** to `classifyMergeFailure` (the classifier itself is proven; the
  wiring is not -- and an earlier version of exactly this wiring was wrong, see §7).
- **The pagination of more than one page of statuses** was not exercised (live commits seen had at most
  2). `--paginate --jq '.[]'` is the documented mechanism; multi-page behaviour is unproven.
- **Timeouts on Windows kill only the direct child**; a reviewer observed grandchildren (`git.exe`
  behind the `cmd\git.exe` wrapper) survive. Not fixed. Behaviour on the Linux runner is unmeasured.
- **A localized git would turn every conflict into `STOP_MERGE_FAILED`** (the classifier matches English
  markers). Fail-closed, not fixed; this machine's git has no translation catalogs so it was not
  reproduced.
- **After a STOP that happens after the merge, the worktree is left mutated.** The STOP result says so
  and prints the restore command; nothing is restored automatically.
- **Side effect of verification**: `devgov.mjs run-red/run-green` write evidence files into the shared
  git common dir of the worktree, which is `C:\miljöbeslut\.git` (at least 20 files for this unit's hash
  at the time of the round-2 review, more since). They live under `.git` and do not affect any working
  tree.
- **Not in `CONTROLLER_OWNED_FLOOR_PATHS`.** The new workflow (which has a secret-bearing `sign:` job) and
  the script are compliant with the floor but are not themselves protected by it, so a later unit could
  modify them. Adding them needs a separate controller-floor unit and is an owner decision.
- **Not independently reviewed after the round-2 repair.**
- Nothing has been pushed to `origin`.

## 6. Base bump

Not applicable -- this is the candidate's first version, not a rebase-reverify of itself.

## 7. Review history and repairs (2026-09-30)

### Round 1 -- review of `b7ddef9f`: SOUND_WITH_CHANGES

Five parallel dimension reviewers + one adjudicator, all fresh agents. No blocker against the design's
hard invariant; five majors. Jimmy's GO authorised fixing them plus three cheap hardening items.

1. `invariant-packs:` job missing (present in `orchestrate.yml` at `base_sha`) and a comment falsely
   calling `gate:` the only structural difference -- job added.
2. PR comment's "Phase 1/2: PASS" was hardcoded text -- replaced by a `reverify-phases:` job whose
   outputs feed the comment.
3. Status lookup unpaginated -- moved to the list endpoint (and a live POST-by-default bug in the first
   attempt at this was found and fixed: `gh api -f ...` needs an explicit `--method GET`).
4. Unbounded, untimed, unretried `gh` loop -- walk cap, bounded retry/backoff, default timeouts.
5. `main()` never run against a real PR -- **still open**, see §5.
6. Plus: wrong `scripts/devgov/...` path references, unvalidated `old_base_sha`/`pr_number`, vacuous
   empty-manifest PASS, all merge failures called "conflict", dead `execFileSync` import.

### Two defects the implementing session found in its own round-1 repair, before round 2 started

- `git merge` writes conflict lines to stdout; the repair classified only stderr, so every real conflict
  would have been `STOP_MERGE_FAILED`. The proof-unit could not see it (it tested the pure function with
  a hand-written string).
- `reverify-phases:` imported the verification functions from the **candidate's** checkout, i.e. it ran
  candidate code in a verifier, against the trust model `plan:`/`sign:` already follow.

### Round 2 -- delta review of `bbbbeec1`: CHANGES_REQUIRED

Three fresh reviewers (workflow YAML, script, proof-unit + this document's honesty). Closure of the
five round-1 majors: (1) CLOSED, (2) CLOSED, (3) CLOSED, (4) CLOSED (by reading; worst-case runtime
still loose), (5) NOT CLOSED, honestly documented. New findings and their disposition:

| finding (severity) | disposition |
| --- | --- |
| `run-red` exits 2 on a correct RED; `run()` threw on any non-zero exit, so `main()` could never reach READY (blocker) | **Fixed**: `runAllowFail` + `parseControllerRun` + `evaluateDryRun`; executed against the real controller (§4) |
| list-statuses returns history; "any success" accepted an old success under a newer failure (major) | **Fixed**: `hasCurrentGreenDevGovStatus`, newest per context decides |
| fixed 150 s timeout kills the 28/59 real units declaring a larger `timeout_ms` (major) | **Fixed**: per-entry `timeout_ms` + 30 s slack |
| Phase 1's "original approval" never verified in CI (major) | **Fixed**: old approval must have a current green status; in `reverifyLineage` |
| `base_sha` anchor too weak: no-merge candidates, base older than the old base, unrelated file edits all passed (major) | **Fixed**: exact lineage (single bump commit on a merge of `[pre-merge tip, new base]`, bump changes only the unit file, new base strictly newer and in main's history) |
| symlink at the unit path passes Phase 1/2 while `plan:`/`sign:` follow it (major) | **Fixed**: regular-file mode (100644) required at all three refs; proof case made byte-identical so only the mode check can stop it |
| `grep -E` shape check is per line, multi-line values pass; `old_base_sha` never cross-checked; `pr_number` not tied to the candidate (minor) | **Fixed**: bash `[[ =~ ]]`, `old_base_sha` cross-check, report job requires the PR's head to equal the signed candidate |
| report job never asserts the phase outputs are `PASS` (note) | **Fixed** |
| comment still omits some structural differences from `orchestrate.yml` (M1 partial) | **Fixed**: complete list in the workflow header |
| tip walk cap applied before the tip check (minor) | **Fixed** |
| three mid-run STOPs leave a local merge and a dirty file; STOP JSON silent about it (minor) | **Partly fixed**: empty-manifest check moved before any mutation; later STOPs state `worktreeMutated` and print the restore command; no automatic restore |
| push succeeded but dispatch failed is reported without saying so (minor) | **Fixed** |
| 11 of 59 real unit files don't round-trip through `JSON.stringify` (note) | **Fixed**: `bumpBaseShaInText` (single-line substitution); Phase 2 also compares bytes |
| `tmpWorktreeAt` leaks the temp dir if `worktree add` throws (note) | **Fixed** |
| `runAllowFail` dropped spawn errors, hiding a timeout (minor) | **Fixed** |
| dirty-tree refusal naming `conflict-policy.md` misfiled as a conflict (minor) | **Fixed**: anchored regexes |
| all five REDs are file-not-found REDs; three GREENs satisfiable by a stub (major, reproduced) | **GREENs fixed** (two-sided, mutation-tested 23/23); REDs remain file-not-found -- inherent, now stated plainly (§3) |
| this document: "all 7 exported pure functions" (there were 5), "three pairs", stale SHAs, DGL-022 called "hint-blessed", no mention that step 5 could not complete | **Fixed** in this rewrite |
| new workflow/script not in `CONTROLLER_OWNED_FLOOR_PATHS` (minor) | **Not fixed -- owner decision** (§5) |
| Windows timeout leaves grandchildren; localized git defeats the classifier (notes) | **Not fixed** -- documented (§5) |
| `reverify-phases` trusts which SHA was approved (minor, round 2) | Subsumed by the status check above |

`--no-ff` was added to the merge so the commit shape the lineage check requires holds even when the
branch has no commits of its own (design §1.4 says `git merge`; this only pins the shape).
