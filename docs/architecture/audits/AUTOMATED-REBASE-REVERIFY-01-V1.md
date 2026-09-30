# AUTOMATED-REBASE-REVERIFY-01-V1

**Final state:** UNVERIFIED. Three independent W1-VERIFY-DB rounds have reviewed this candidate and each
returned changes; every finding of all three is dispositioned in §7. The functional candidate is
`50515a09759563f7bffc81a4cfefb140021a6ed5`; the branch tip is a docs-only commit on top of it. The
round-3 repair has **not** itself been independently re-reviewed. `origin` holds an EARLIER candidate
(`4d6388218ad8e09d96229a2519c824abb9a62824`, pushed by someone other than the implementer after round 2);
everything after it is local only. Nothing here has run in GitHub Actions or against a real PR -- read §5
before reading any "verified" below.

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
  that no Dev-Gov unit may ever add to or modify. The decision logic is in exported functions, each
  with an executed proof in the unit: `phase1VerifyOriginalIdentity`, `phase2VerifyOwnEdit`,
  `bumpBaseShaInText`, `classifyStaleness`, `assertNonEmptyManifest`, `classifyMergeFailure`,
  `newestDevGovState`, `hasCurrentGreenDevGovStatus`, `parseRepoSlug`, `parseArgs`,
  `parseControllerRun`, `evaluateDryRun`, `reverifyLineage` (13 functions, plus the `STOP` and
  `DEVGOV_STATUS_CONTEXT` constants). **Not** covered by the unit, because they are I/O: `detectStaleness`,
  `locatePriorApprovedSha` (the history walk, cap and retry), `listCommitStatuses`, the merge/commit/push/
  dispatch sequence and the temp-worktree lifecycle inside `main()` -- see §4 for what was executed
  instead.
- `.github/workflows/devgov-v0-rebase-reverify.yml` -- step 6 (RED/GREEN re-run + sign, in CI,
  `environment: devgov-attestation`) and step 7 (stop, post an evidenced PR comment). A new, separate
  file rather than a modified `devgov-v0-orchestrate.yml`: that file's own `gate:` job unconditionally
  dispatches `devgov-v0-gate.yml` immediately after `sign:` succeeds, with no input to stop earlier --
  reusing it as-is would violate the design's "never dispatches `devgov-v0-gate.yml`" rule. Its complete
  list of structural differences from `orchestrate.yml` is in the file's header.
- `governance/devgov/units/automated-rebase-reverify-01-v1.json` -- this candidate's own proof-unit
  (13 RED + 13 GREEN).

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
fixed on `origin/main` on 2026-09-17 (`0b5155e5`/`ca27eaf6`), before the design was written. (Round 3 then
found the *same defect class* in this candidate's own report job, `gh pr comment` without `--repo`; fixed.)

## 3. Proof-unit design, and what it does and does not prove

Thirteen RED/GREEN pairs. Each GREEN calls the real exported function(s) and asserts **both directions**:
legitimate input is accepted and each adversarial input is rejected.

| pair | what the GREEN asserts |
| --- | --- |
| phase1-rejects-drift-and-accepts-identical | identical bytes accepted; `base_sha` drift, other-field drift and a pure reformat rejected |
| phase2-accepts-exact-edit-and-rejects-everything-else | the exact base_sha edit accepted; extra-field, wrong value, 4-space re-serialisation, dropped newline, CRLF, key reorder, BOM, no-op and malformed JSON rejected |
| staleness-gate-scope | only BEHIND + MERGEABLE in scope; every other state and mergeable value stops with the right reason |
| empty-manifest-fails-closed | every empty/missing RED/GREEN shape fails closed; a non-empty manifest passes |
| merge-failure-classification | both git conflict markers classified as conflict; unrelated-history, dirty-tree (incl. a file named `conflict-policy.md`) and empty output are not |
| status-newest-per-context-decides | the NEWEST status for the context decides; sibling contexts, array order and id-vs-timestamp do not mislead it |
| controller-exit-code-tolerance | the controller envelope is read at exit 0/2/3/4; empty, non-JSON, envelope-less and any spawn error (even with valid stdout) is a harness error |
| dry-run-evaluation | correct run passes; EVERY entry is judged; failing/unexpected/missing/empty stop as candidate failure; blocked/denied is STOP_DRY_RUN_INCONCLUSIVE |
| base-sha-single-line-bump | exactly one top-level line changes; CRLF/no-newline preserved; nested `base_sha` untouched; 0 or 2 matches and every malformed SHA (39/41 chars, upper case, newline-wrapped) fail closed |
| lineage-structure-accepts-honest-rebase-rejects-forgeries | real git histories: the honest rebase accepted; forged tamper/unmerged-base/extra-file (sorting before and after)/no-merge/octopus (clean-merge tree)/foreign first parent/swapped parents/evil merges (extra file, tampered main file, `-s ours`)/older base/nonexistent object/side-branch base rejected, each by its intended check |
| lineage-approval-modes-and-paths | approval must be current-green (newest wins, sibling contexts ignored), tree-identical to the tip (unreviewed code after approval, drift rejected; an empty commit accepted), an ancestor (an identical-tree twin rejected); modes 100644 at all three refs; malformed SHAs; unsafe unit paths incl. an existing path with a space |
| repo-slug-parsing | https/ssh/scp-style remotes incl. dotted repo names; null for anything else |
| cli-argument-validation | valid flags parsed; unknown flags, swallowed/missing values, `--dispatch` without `--push` and non-integer `--pr` rejected |

**Every RED is a "file not found" RED.** At `base_sha` (`740b2fdf`) the script does not exist, so each RED
fails at the `import()` in its wrapper before any logic runs. That proves only that the capability does not
exist before this candidate, not that any semantic property fails -- inherent to a unit that adds a new
file. `devgov-helper.mjs lint` flags this on every RED (DGL-022); the warnings are **accepted, not
suppressed, and not "hint-blessed"** (the lint hint's exemption applies when the artefact's absence *is*
the property under test, which is not the case here). The lineage REDs run no git at all, because lint
forbids git in a RED (DGL-021). Consequently **the GREEN entries carry all the proof.**

**How strong the GREENs are -- the record of this claim has been corrected twice.**
1. Round 2's reviewer showed three GREENs passed with an always-reject stub; they were made two-sided.
2. The implementer's own mutation run then reported 23/23 killed. **That number was self-selected and
   overstated.** Round 3's reviewer ran 55 of their own mutants (off-by-ones, swapped arguments, dropped
   checks, loosened regexes, one per decision the lineage function makes) against the same unit:
   **14 killed, 41 survived; 14 of the survivors were equivalent or untestable by design, and 16 were
   genuine test gaps** (a forgery the original code rejects but a mutant accepts): first merge parent,
   octopus, old-ancestor check dropped/swapped, older base, the catch path, main-history check run
   against the wrong repo, only-first-changed-file, mode checks at each ref and 100755, the path
   character whitelist, `evaluateDryRun` judging only the first entry, `classifyStaleness` in-scope for
   anything but CLEAN, the phase-2 byte check as a self-compare, SHA regex anchors, the spawn-error
   branch, sibling status contexts and timestamps. The code itself rejected every forgery the reviewer
   tried; the gap was in the tests.
3. The bodies were rewritten (incl. splitting the lineage proof in two and giving the controller its own
   clone that holds a side branch's objects so each check can only be rejected by itself). A new mutation
   run seeded with **the reviewer's 16 confirmed survivors** plus mutants for the round-3 logic and the
   earlier ones: a first run killed 38/42 (three test gaps -- octopus and second-parent masked by the
   merge-tree check, a value flag swallowing the next flag -- and one wrong mutant of mine); after fixing
   those, **42/42 killed.** This is still the implementer's own mutant
   list plus the reviewer's 16 -- it is a strong regression net, not independent proof, and the next
   independent review should build mutants of its own.
4. Every lineage rejection was also printed with its reason and checked against the *intended* check (a
   harness fault can make everything reject for unrelated reasons); this exposed one case (a base absent
   from the controller repo) that was being rejected by a different check, fixed as above.

Lint: 0 errors; warnings are 13x DGL-022 (above) and 2x DGL-040 on the two lineage GREENs -- a heuristic
false positive: violations there are recorded and `V()` is called only after the `finally` has removed the
sandboxes.

## 4. Local verification performed

Against real local worktrees (`C:\wt-automated-rebase-reverify-01` at
`50515a09759563f7bffc81a4cfefb140021a6ed5`; a disposable worktree detached at
`740b2fdfa1faffb19b922d4eaeb187ce492521cf`, removed afterwards), via the real, unmodified controller
(`node scripts/devgov/devgov.mjs run-red` / `run-green`; note these write evidence files into the shared
git common dir `C:\miljöbeslut\.git`):

- **All 26 proof entries matched `expected_classification`**: 13/13 RED observed `FAIL` (controller exit
  2), 13/13 GREEN observed `PASS` (exit 0). `devgov-helper.mjs lint` 0 errors; controller `preflight` PASS.
- **`main()` was executed end to end** by a local harness: a bare `origin`, a working clone, the real
  controller copied in, and `gh` faked at the Node level by a `NODE_OPTIONS=--import` preload (no network).
  **37/37 checks passed**: the dry-run reaches READY with the expected commit graph (one bump commit over a
  merge of `[pre-merge tip, new base]`) and a one-line bump diff; nothing is pushed on a dry-run; the temp
  base worktree is removed; `--push --dispatch` fast-forwards origin, the dispatch payload carries every
  field incl. `pre_merge_tip_sha`, targets `devgov-v0-rebase-reverify` and never the gate; each STOP path
  (not BEHIND, not mergeable, no approval, tip newest status failure, unreviewed code after the approval, a
  real content conflict reaching `STOP_MERGE_CONFLICT` through git's stdout, a RED that unexpectedly
  passes, an unsupported 4-space layout found before any mutation, an empty GREEN list) stops with the
  right code and pushes nothing; the printed `restoreCommand` really restores the worktree; a rejected
  push exits 2 and fires no dispatch; a mistyped flag is an error; omitting `--repo` resolves this
  project's own dotted-name origin URL. **The first run of this harness failed 15 of 36 checks because of a
  bug in the harness itself** (its fake `gh` looked up statuses at the wrong path index), not in the
  script; fixed and re-run. The harness and the mutation runner are kept outside the repo in
  `Claude outputs/merge-queue-automation-2026-09-30/verification-tools/`.
- **The script's dry-run I/O path was executed against the real controller** on this unit: 13 RED + 13
  GREEN through `runManifestEntries -> parseControllerRun -> evaluateDryRun` (run from a scratch copy of
  the script with one appended `export` line, cwd `C:\`), verdict `ok`; a GREEN run against the wrong HEAD
  gave exit 4 / `DENIED_GOVERNANCE`, reported as `STOP_DRY_RUN_INCONCLUSIVE`, not a crash.
- **The workflow's `reverify-phases` step** was extracted from the real YAML and executed against a
  synthetic git history with `gh` intercepted by a preload: the honest rebase produced the three PASS
  outputs and the exact `gh api` argv verified live; a newest-failure status, a tampered bump and an
  `old_base_sha` mismatch each failed the step.
- **The `plan` job's shape validation** was extracted and run under bash with hostile values (multi-line,
  trailing newline, leading zero, upper-case, `..`/absolute/space paths): all rejected.
- **`gh pr comment` without `--repo`** was reproduced with real `gh` 2.92 in a directory that is not a git
  repository ("failed to run git: fatal: not a git repository"); with `--repo` the call proceeds to the
  network (tested against a dead host, so nothing was written).
- **Live GitHub API** (read-only): `gh api --method GET --paginate --jq '.[]' -f per_page=100
  repos/JbmbAb/Milj-beslut-V1.2/commits/{sha}/statuses` returns NDJSON; a PR head
  (`8e8af6682646cf7805bb7e8586804afa74e807a0`) returned a success `DEV-GOV-V0 / trusted-execution` newer
  than an earlier pending; a commit with no statuses returns empty output. Omitting `--method GET` makes
  `gh api -f ...` hit the create-a-status handler (HTTP 422 "State is not included in the list");
  reproduced by the round-1 implementer against `740b2fdf` and by a round-2 reviewer with a bogus SHA
  (write-shaped requests rejected by validation; nothing was created).
- **Git behaviour**: `git merge` writes its `CONFLICT` / `Automatic merge failed` lines to **stdout** with
  empty stderr (git 2.54), reproduced by the implementer and independently by reviewers.

## 5. What has NOT been verified (non-claims)

- **No GitHub Actions run of any kind.** Nothing in `devgov-v0-rebase-reverify.yml` has executed on a
  runner. Only pieces extracted from it were run locally, on Windows, with `gh` faked where needed. The
  Linux runner, `realpath` containment in `plan:`/`sign:`, the reusable-workflow calls into
  `devgov-v0-attest.yml`, job-level `permissions` inheritance, and the environment-gated `sign:` job
  (needs `DEVGOV_ATTESTATION_PRIVATE_KEY_PEM`, unavailable to this session) are unexercised; no GitHub
  schema lint (`actionlint`) was available.
- **Bootstrap.** The workflow is resolved from the default branch only, and `reverify-phases` loads its
  logic from `controller/` (the default-branch checkout), so nothing can be dispatched end to end until
  this lands on `main` together with the script. Without the script on `main` the step fails closed
  (`ERR_MODULE_NOT_FOUND`, reproduced).
- **Unverified assumption: the evidence gate accepts attestations produced by this workflow.** Reading
  `devgov-v0-gate.yml` and the controller found no check pinning the attestation run to
  `devgov-v0-orchestrate.yml` (artifacts are fetched by `run-id`; acceptance rests on the signature, the
  hard-coded `workflow_ref` = `devgov-v0-attest.yml@main`, and the run id, all of which this workflow
  reproduces). **One real constraint was found:** the gate requires each attestation's `controller_sha`
  to equal the gate run's own `github.sha` (`devgov.mjs:353`, read and confirmed), so the attestations signed here are only
  accepted if `main` has not moved before the owner dispatches the gate; the evidence comment now says
  to dispatch promptly. All of this is reading, not a test.
- **`main()` has not run against real GitHub.** It has run end to end locally (§4) with a faked `gh` and a
  local bare origin, which closes the "never executed" gap for everything except: real `gh`
  authentication and rate limits, real pagination beyond one page (live commits seen had at most 2
  statuses; `--paginate --jq '.[]'` is the documented mechanism), a real push to GitHub, the real
  `repository_dispatch`, fork PRs and non-default base branches (both fail closed), and Linux.
- **The approval is a commit status.** `DEV-GOV-V0 / trusted-execution` is checked only for context and
  state; any actor with write access can post one, and it is not bound to a unit or to a gate run (the live
  `target_url` points at the gate run and could be verified). The approval is now bound to the tip's
  whole tree, but not cryptographically to an attestation.
- **Timeouts on Windows kill only the direct child**; a reviewer observed grandchildren (`git.exe` behind
  the `cmd\git.exe` wrapper) survive. Behaviour on the Linux runner is unmeasured.
- **A localized git would turn every conflict into `STOP_MERGE_FAILED`** (the classifier matches English
  markers). Fail-closed, not reproduced (this machine's git has no translation catalogs).
- **Two of 59 real unit files** (4-space layout) are rejected by the base_sha bump, now before any
  mutation; the other 57 were run through the bump and Phase 2 by a reviewer.
- **The local dry-run runs RED in a bare temp checkout with no `node_modules`**; a reviewer counted 5 real
  RED entries that use `npx` (not re-counted by the implementer), so a failure there may not be the
  intended one. It is a pre-check only.
- **After a STOP that happens after the merge, the worktree is left mutated.** The STOP result says so and
  prints the restore command; nothing is restored automatically.
- **Side effect of verification**: `devgov.mjs run-red/run-green` write evidence files into the shared git
  common dir, `C:\miljöbeslut\.git`, under `.git` only.
- **Not in `CONTROLLER_OWNED_FLOOR_PATHS`.** The new workflow (which has a secret-bearing `sign:` job) and
  the script are compliant with the floor but are not themselves protected by it, so a later unit could
  modify them. Adding them needs a separate controller-floor unit and is an owner decision.
- **Not independently reviewed after the round-3 repair.**

## 6. Base bump

Not applicable -- this is the candidate's first version, not a rebase-reverify of itself.

## 7. Review history and repairs (2026-09-30)

### Round 1 -- review of `b7ddef9f`: SOUND_WITH_CHANGES

Five parallel dimension reviewers + one adjudicator, all fresh agents. No blocker against the design's
hard invariant; five majors, all fixed or carried: (1) `invariant-packs:` job missing and a false
"only difference is `gate:`" comment -- added/corrected; (2) hardcoded "Phase 1/2: PASS" in the PR comment
-- replaced by a `reverify-phases:` job; (3) unpaginated status lookup -- moved to the list endpoint (and a
live POST-by-default bug in the first attempt found and fixed); (4) unbounded, untimed, unretried `gh`
loop -- cap, retry/backoff, timeouts; (5) `main()` never run against a real PR -- open then, partially
closed by the local harness in round 3 (see §5). Plus wrong path references, unvalidated payload fields,
vacuous empty-manifest PASS, all merge failures called "conflict", a dead import.

### Two defects the implementer found in its own round-1 repair, before round 2

`git merge` writes conflict lines to stdout (the repair classified only stderr); and `reverify-phases:`
imported its verification functions from the **candidate's** checkout, i.e. ran candidate code in a
verifier.

### Round 2 -- delta review of `bbbbeec1`: CHANGES_REQUIRED

Blocker: `devgov.mjs run-red` exits 2 on a correctly failing RED and the script threw on any non-zero exit,
so `main()` could never reach READY -- hidden precisely because `main()` had never run. Majors: list-statuses
history ("any success" accepted an old success under a newer failure); Phase 1's approval never verified in
CI; the `base_sha` anchor too weak; a symlink at the unit path; a fixed 150 s timeout killing 28 of 59 real
units; all REDs file-not-found and three GREENs satisfiable by a stub; false/stale statements in this
document. All fixed in `6a849b61`.

### Round 3 -- delta review of `4d638821`: CHANGES_REQUIRED

Three fresh reviewers: the script as a running program (with their own end-to-end harness), the workflow +
`reverifyLineage` (~75 forged and honest inputs), and the proof-unit + record (55 mutants). Closure of the
round-1 majors: 1-4 CLOSED, 5 partially closed. New findings and their disposition (fixed in `50515a09`
unless stated):

| finding (severity) | disposition |
| --- | --- |
| approval bound to the unit file, not the code: an ancestor with a green status approved a tip carrying unreviewed code (major, found independently by two reviewers) | **Fixed**: approved commit's tree must equal the tip's tree; `locatePriorApprovedSha` only considers same-tree commits and the first one with any status decides |
| the merge commit's tree never checked: evil merges (extra workflow file, tampered main file, `-s ours`) passed (major) | **Fixed**: tree must equal `git merge-tree --write-tree` of its parents; executed proof with three evil merges |
| `gh pr comment` without `--repo`, no checkout in the report job: step 7 would never post (major) | **Fixed**; reproduced with real gh before and after |
| `resolveRepoSlug` regex forbids dots: the documented default fails on this project's own origin (major) | **Fixed**: `parseRepoSlug`, tested |
| controller `controller_sha` must equal the gate run's `github.sha` (minor) | **Documented** in the evidence comment and §5 |
| a merge killed by the timeout leaves a dirty tree and the printed `merge --abort` fails (minor) | **Fixed**: state measured, `reset --hard` restore printed, verified end to end |
| exceptions after the merge report no mutation (minor) | **Fixed**: module-level restore hint printed by the top-level handler; verified with a rejected push |
| unsupported base_sha layout found only after the merge (minor) | **Fixed**: probed before the merge; verified |
| BLOCKED/DENIED dry-run labelled "a real candidate failure" (minor) | **Fixed**: `STOP_DRY_RUN_INCONCLUSIVE` |
| `git fetch origin <base>` assumes the default refspec; unknown flags silently ignored (minor/note) | **Fixed**: explicit refspec; strict `parseArgs` |
| `execFileSync` 1 MiB buffer limits statuses (note) | **Fixed** in the workflow (`maxBuffer`); the script uses `spawnSync` with its default |
| stale/false statements in this document: "nothing is pushed", "verified candidate", "each has an executed proof", "23/23 ... one per decision", "13 forged" (minor) | **Fixed** in this rewrite |
| 41 of 55 independent mutants survived, 16 genuine test gaps (major, proof quality) | **Fixed**: bodies rewritten; 42/42 of a mutation run seeded with those 16 (see §3 for its limits) |
| the old approval is a forgeable commit status (note) | **Not fixed** -- documented (§5) |
| new workflow/script not in `CONTROLLER_OWNED_FLOOR_PATHS` (minor) | **Not fixed -- owner decision** |
| Windows timeout grandchildren; localized git; fork PRs; non-default base; `npx` in the bare RED checkout (notes) | **Not fixed** -- documented (§5) |

`--no-ff` is used for the merge so the commit shape the lineage check requires holds even when the branch
has no commits of its own (design §1.4 says `git merge`; this only pins the shape).
