# SECURITY-HARDENING-HD04-HD09-V1 -- HD-04..HD-09 findings from A9

**Status:** four candidates COLD_VERIFIED twice (K-159 first round, second round after a rebase),
pushed to origin both times on Jimmy's explicit go, and dispatched into the Dev-Gov
orchestrate/gate pipeline on his "dispatch" -- **all four failed at the RED execution step** (see
§9). Root cause found, fixed, and re-verified locally; not yet re-reviewed, re-pushed, or
re-dispatched as of this writing. Details in §9, at the end of this document.

**Units:** four, see `governance/devgov/units/devgov-security-hardening-hd04a-hd04b-hd05-v1.json`,
`devgov-security-hardening-hd06-v1.json`, `devgov-security-hardening-hd07-hd08-v1.json`,
`devgov-security-hardening-hd09-v1.json`
**Base:** `dc78d44cd47c9a9cc46ffc805a53751861221765` (origin/main tip after HD-sweep-A9-01 PR #196
and V1-THROUGHPUT's same-run-signing restructure of `devgov-v0-attest.yml`/`devgov-v0-orchestrate.yml`).
Bumped twice total: `760d5a15` (original) -> `b48ed5e2` (mid-session, before first push) ->
`dc78d44c` (this bump, after push+cold-review+push-go, per Jimmy's explicit go to proceed once
main had advanced again -- W3a, W3b, HD-sweep-A9-01, V1-THROUGHPUT all landed in between). Each
bump confirmed zero file-level overlap with this work's own touched files before merging (verified
via `git diff --name-only <old-base>..origin/main`, not assumed), and RED/GREEN were re-verified
against each new base before committing the bump, per the startbrief's own "if main moves, bump
and re-verify" instruction.
**Design authority:** `Claude outputs/lu-maps-2026-09-26/SECURITY-HARDENING-SESSION-BRIEF-2026-09-29.md`,
Jimmy's owner decision K-149 (`HDR20-OWNER-DECISION-ROUND-2026-09-29.md`), sourced from the A9
route-reachability sweep (`A9-ROUTE-REACHABILITY-SWEEP-FINAL-2026-09-29.md`). HD-06's fix design
(replace the client-supplied `bankidId` with a verified-session `orderRef`) was confirmed with
Jimmy in-session before any code was written.

**Candidate SHAs, current (post-rebase + RED-command fix + base_sha-regression fix, not yet
re-reviewed/pushed):**

| Unit | Branch | Candidate SHA | Pushed+dispatched SHA (failed, §9) | First-round SHA (COLD_VERIFIED K-159, pushed) |
|---|---|---|---|---|
| A (HD-04a/HD-04b/HD-05) | `claude/security-hardening-hd04-05-v1` | `ed2a5146cb63b0f80ab6533eac387025b5dfe1b8` | `428cd71c2f2eea960b3b74e3043fd7c0d4ef54f3` | `1911598925613370d42a2ace506eb0add08829d8` |
| B (HD-06) | `claude/security-hardening-hd06-v1` | `cc8047d72afde3afa2b0ce2ddb20fe50856df4b0` | `89e3b29a1cc7f75a7926895f466df4f6c3c49c2d` | `3615e94ca6e5ff8546897fa22facac1a6f576354` |
| C (HD-07/HD-08) | `claude/security-hardening-hd07-08-v1` | `853d1d3f9f9423a1b4cf6368d195ee17bb0099f6` | `387df4e11114165ab1b9a824fa6f71a4d19af292` | `c696e562f31504ecb4d397fbe6b8a4da6463c68e` |
| D (HD-09) | `claude/security-hardening-hd09-v1` | `1f4ba141945cdec4d8b04247264c142b50469185` | `f56f40e5c48bf7a01c19324cf6bb62cdd0e621cc` | `0c7817a5e031446d6400767ef312414d5c6fd27f` |

Each current SHA is two `fix(devgov)` commits on top of the pushed+dispatched SHA in the middle
column: the `required_red` fix (§9), then a second commit correcting a `base_sha` regression that
fix's own propagation accidentally introduced (§9, final paragraph) plus a `process.on('exit', ...)`
cleanup improvement. No production code or test content changed in either commit, only the RED
probe's execution mechanism and the unit definition's own metadata. `devgov-helper.mjs preflight`
reports 0 errors on all four at these exact SHAs. The pushed+dispatched SHA is itself a merge commit
(`origin/main` at `dc78d44c`, no force, no conflicts) plus a `base_sha`-bump commit on top of the
first-round SHA already pushed and cold-reviewed once. The rebase and re-verification that produced
the middle column were authorized in-session by Jimmy
("fortsätt godkänner") after a separate, unverified cross-session message claiming the same
authorization under the display name "Boss" was identified and explicitly refused -- see the
security-hardening session's own transcript for that exchange; not repeated here since it is
process history, not part of this unit's code.

## 0. Grouping rationale

Four units, not one and not six, chosen when the six findings were read against source:

- **A** (HD-04a + HD-04b + HD-05): one vulnerability class -- a route trusts a client-supplied
  reviewer/applier identity instead of the authenticated session -- across two closely related
  route files. Mechanical, no design questions.
- **B** (HD-06 alone): the startbrief itself required a scope review before any code ("kan vara
  större än en enradsfix"), and the review confirmed that -- it touches three files across two
  layers (route + service + a new read path on the replay-protection module) and one real API
  contract change. Kept separate so that reopening/repair of this specific design doesn't churn
  the other findings.
- **C** (HD-07 + HD-08): same two files, one coherent "GDPR deletion must not overclaim success"
  fix -- org-scoping the admin path and making the response honest about partial storage-deletion
  failures share the same return-value plumbing.
- **D** (HD-09 alone): the startbrief required running the full test suite before and after this
  specific change, independent of the others, so it gets its own unit and its own before/after
  evidence (§4).

## 1. Unit A -- HD-04a + HD-04b + HD-05: reviewer identity forgeable

**Reachability confirmed, not assumed.** Read `server/createApp.ts` in full: `classificationReviewRouter`
(line 167) and `recommendationRoutes` (line 215) are both mounted directly on `app` with no shared
prefix. The former's routes are bare (`/classifications/...`), the latter's are self-prefixed
(`/api/recommendations/...`) -- two disjoint, simultaneously live URL spaces, not a collision.
HD-04a/04b's unauthenticated endpoints are genuinely reachable in production exactly as the sweep
found.

**Fix:** `requireAuth` added to `classification-review.routes.ts`'s `submit-review` and `apply`
routes only (not the file's other routes -- `recommend`, `mark-reviewing`, `verify-integrity`,
`audit-trail`, `approval-gate/*` -- which A9/HDR20 did not flag and K-149 did not approve fixing;
touching them now would be scope creep on an unrelated later decision). `reviewedBy`/`appliedBy`
now come from `req.authUser.id` in both `classification-review.routes.ts` and
`recommendationRoutes.ts`; the old "reviewedBy/appliedBy required" body-validation checks were
removed since the value is no longer sourced from the body at all.

**Correction to the brief:** `recommendationRoutes.ts` had zero dedicated test coverage before
this unit (`tests/unit/recommendationRoutes.test.ts` did not exist -- created here). More
importantly, a **second, previously undiscovered test file** exercises the same route:
`tests/unit/alphaevolveSearchRoutes.test.ts` had its own `POST
/api/recommendations/:recommendationId/submit-review` test asserting `reviewedBy: 'John Doe'` (the
client-supplied value) was passed straight through -- i.e. it asserted the HD-05 vulnerability
itself as correct behaviour. This was only found by running the complete unit-suite failing-file
list before and after the fix (§4 method) and diffing it; the fix legitimately broke that
assertion. Corrected the test's expectation to the authenticated identity and added a companion
test proving a forged `reviewedBy` in the body is ignored, matching the pattern used in this
unit's other test files. `alphaevolveSearchRoutes.test.ts` is therefore part of this unit's
`allowed_paths`, not part of the original six-finding list.

## 2. Unit B -- HD-06: invitation acceptance trusted an unverified BankID identity

**Scope review (as the brief required before writing code):** `orgInvitationService.acceptInvitation`
took a raw `bankidId` string from the request body and used it directly in `prisma.user.findFirst`/
`prisma.user.create` -- `persistentReplayProtection` (the module that *does* record a verified
`bankidId` after a real completed BankID collect, in the `bankIdSession` table) was never consulted
by this path. Checked for existing callers of the old contract across the repo (frontend, scripts,
tests): none exist outside tests, so changing the contract breaks no live integration.

**Fix design (confirmed with Jimmy):** replaced `bankidId` in the request body with `orderRef`.
`persistentReplayProtection` gained a new read method, `getCompletedSession(orderRef)`, returning
the verified `bankidId` only if that session's `status === 'COMPLETED'` (the same status
`validateAndComplete` sets after a genuine BankID collect). `acceptInvitation` now resolves
`bankidId` exclusively from that verified session and fails closed (`BankID-sessionen är inte
verifierad eller har inte slutförts`) if no completed session exists for the given `orderRef`.
`organisation.routes.ts`'s `/invitations/accept` handler now requires `orderRef` instead of
`bankidId` in the body.

**Known non-blocking follow-on, not fixed here:** a single completed BankID session's `orderRef`
could in principle be presented to `acceptInvitation` more than once, or reused across both a
normal login and an invitation-accept. This is not the vulnerability HD-06 named (the identity
proof behind it is still genuine, not forged), and the invitation itself is single-use
(`invite.status` transitions to `ACCEPTED`), but a product decision on one-time-use session
semantics is a reasonable future hardening step, not part of this unit.

## 3. Unit C -- HD-07 + HD-08: GDPR deletion could cross organisations and overclaim success

**HD-07 fix:** `gdprComplianceService` gained `getUserOrganisationId(userId)`. The admin delete
route (`DELETE /api/admin/gdpr/users/:userId`) now fetches the target user's organisation and
returns 403 (matching the codebase's existing cross-org-access convention in
`organisation.routes.ts`) unless it equals the acting admin's own organisation. The transaction
itself only anonymises the *deleted* user's own prior audit rows (`auditTrail.userId = null`) --
it never recorded that this admin performed the deletion. Added an explicit
`appendDomainAudit({ action: 'GDPR_ADMIN_PERMANENT_DELETE', ... })` call after a successful
deletion, using the same audit helper already established for org-invitation events.

**HD-08 design choice (as the brief asked for, documented here):** two options were considered for
a storage-file deletion failure inside `permanentlyDeleteProjectData`'s transaction --
(a) roll back the whole transaction on any storage failure, or (b) let the database deletion
proceed and report the failure honestly. Chose (b): GDPR Article 17 erasure of the database
records (the actual personal data) should not be held hostage by an unrelated, possibly transient
storage-backend error, and `permanentlyDeleteUserData` already loops over every project a user
owns -- a single failing file under option (a) would silently abort deletion of a user's *entire*
data set, a far larger and more surprising blast radius than the one failing file. Both
`permanentlyDeleteProjectData` and `permanentlyDeleteUserData` now return `storageDeletionFailures:
string[]`; both `gdpr.routes.ts` DELETE handlers (self-service and admin) set `ok` to `false` and
`partial` to `true` whenever that array is non-empty, instead of unconditionally claiming
`ok: true`.

**Scope note:** the identical swallow-and-continue pattern also exists in `scrubProjectData`
(a different, non-deletion function, lines 234-241 at base) -- left untouched; HD-08 named
`gdprComplianceService.ts:93` specifically, and `scrubProjectData` is not part of K-149's six.

## 4. Unit D -- HD-09: fabricated signature fallback

**Test-impact investigation, done before writing the fix (per the brief's explicit requirement):**
read every scenario in `tests/unit/bankIdService.test.ts` (23 at base) plus `authRoutes.test.ts`.
Every "complete" collect scenario -- mock and real -- already supplied an explicit `signature`;
mock mode's own `buildMockCompletionData` fabricates one unconditionally
(`mock-signature-${bankidId}-${crypto.randomUUID()}`), so no test relied on the `|| mock-sig-...`
fallback for the mock flow specifically. **Fix:** removed the fallback; `collectBankIdResult` now
throws `BankID complete response missing signature` (fail-closed) whenever
`completionData?.signature` is absent, on both the mock and real paths uniformly.

**One real regression found and fixed, exactly as the brief warned might happen:** the existing
test `rejects complete responses for users outside permitted organisations` built a `completionData`
fixture that omitted `signature` -- not to test signature handling, but because that test is about
a later check (`resolveAuthUser`'s org-permission gate) and the author didn't need a signature to
reach it. Under fail-closed semantics this fixture now fails at the *earlier* signature check
before ever reaching the org-permission logic it was meant to test. Fixed the fixture (added a
`signature` field) rather than weakening the production fix -- the test's intent (org-permission
rejection) is unchanged and still exercised.

**Full unit-suite run, before and after, as required:** see §5 for method and the one additional
genuine regression that method caught (Unit A, not Unit D).

## 5. Evidence: full-suite before/after, and how a second regression was actually found

A single before/after summary-count match (15 failed files / 24 failed tests, unchanged) is not
by itself proof of "no regression" -- the *same total* can hide one test flipping pass→fail while
an unrelated flaky one flips fail→pass. Ran the full `unit` project (1746-1759 suites, ~4800-4850
tests) with the `json` reporter piped to disk (the terminal-capture path truncates well before a
run this size completes) at base_sha and again at the candidate, and diffed the complete failing
**file** lists, not just the summary counts:

- 4 files failed at base but not at candidate (`NoAlternateLuDecisionPath.test.ts`,
  `adminDbStatusPanel.test.ts`, `dbAnalysis.test.ts`, `import-librarian-manifest.test.ts`) --
  none touch anything this unit changed; consistent with pre-existing flakiness in this suite.
- 2 files failed at candidate but not at base (`alphaevolveSearchRoutes.test.ts`,
  `execSummaryQueueService.test.ts`). The first was the real Unit-A regression described in §1,
  now fixed. The second was re-run in isolation (11/11 passed) to confirm it was flaky under
  full-suite parallel load, not caused by this branch -- it does not touch auth, GDPR, BankID, or
  any file this work modifies.
- After the Unit A fix, the full affected-file suite (8 files, 115 tests: the six files this work
  touches plus `alphaevolveSearchRoutes.test.ts`) passes cleanly, and the merge to the bumped
  `base_sha` (§ Base, above) did not change this.

## 6. Local verification method (RED and GREEN both re-run against the bumped base_sha)

Each unit's `required_red`/`required_green` commands were executed exactly as the controller would
run them (`node -e "<embedded body>"`, not a saved script file, since `node -e` defaults to
CommonJS regardless of this repo's `"type": "module"` -- a saved `.js` file does not) directly
against this checkout:

- RED: production files for that unit reset to the exact `base_sha` content (verified via
  `git show HEAD:<path>` diffed against the working copy, not `git stash` -- see note below --
  restored from an in-memory backup after each run), the unit's test files run via a temp probe
  copy. All four: **FAIL as expected** (Unit A 12/42, Unit B 5/24, Unit C 13/23, Unit D 1/26).
- GREEN: production files restored, the real committed test paths run directly. All four:
  **PASS** (Unit A 42/42, Unit B 24/24, Unit C 23/23, Unit D 26/26).

**Process note, for whoever reviews this next:** `git stash` is a repository-level ref shared
across every worktree of this repo, not a per-worktree one. Mid-session, a `git stash pop` here
collided with another concurrently active session's own stash operation on this same repository --
it silently reverted this unit's Unit-A production fix (the two route files) and left an unrelated
scratch file (`scratch-f10-synthetic-test.mjs`, a throwaway probe for
`evaluateRepositoryState`'s forbidden-path floor, not from this unit) sitting in this worktree.
Caught immediately by re-running the affected-file GREEN check, which failed unexpectedly; the fix
was re-applied from the known diff and re-verified. The stray file was moved out to this session's
own scratchpad rather than deleted outright, since it may be some other session's lost
in-progress work. **`git stash` was not used again for the remainder of this unit's verification**
-- the RED/GREEN re-checks against the bumped base above use `git show <sha>:<path>` plus an
in-memory backup/restore instead, which is worktree-local and cannot collide with another session.

## 7. Non-claims

What this document does *not* assert, so the next reader doesn't have to guess:

- **No `tsc` typecheck evidence.** This repo's root `tsconfig.json` excludes `server`, `tests`,
  and `scripts` entirely, so a root `npm run typecheck` would silently type-check none of this
  unit's files -- exactly the same gap the `LU-W3C-FAIL-OPEN-WATER-AVAILABILITY-V1` audit flagged
  for its own unit (its §0/S2). There is no server-scoped `tsconfig.json` in this repo to run
  instead. The evidence here is vitest's own esbuild transform succeeding (a real TS syntax or
  bad-import error would abort the run, not just fail an assertion) plus manual review, not a
  `tsc` pass.
- **No integration-level (real Postgres) test evidence.** All verification is at the `unit` vitest
  project level (mocked prisma/BankID/replay-protection), matching every existing test file this
  unit extends. `tests/setup/database.ts`-backed integration tests were not run.
- **The full-suite before/after diff (§5) is not a claim that every one of the ~4800 tests was
  individually re-examined.** It is a complete *file-level* diff of the failing set from two full
  `json`-reporter runs, cross-checked by re-running the two files that moved in either direction
  in isolation. The set of tests that stayed identically passing in both runs was not re-inspected
  test-by-test.
- **HD-06's known non-blocking follow-on (§2, single-session reuse) is not fixed.** It is named so
  it isn't mistaken for an oversight.
- **This candidate has not been reviewed by the independent verifier session** (per the model in
  the startbrief) and has not been pushed. Nothing in this document should be read as "ready to
  merge."

## 8. What was not touched

- No production file outside each unit's declared `allowed_paths`.
- `classification-review.routes.ts`'s other unauthenticated routes (see §1) -- explicitly out of
  K-149's six.
- `scrubProjectData`'s identical swallow-and-continue pattern (see §3) -- explicitly out of scope.
- HD-01/02/03 and HD-10..HD-16 from the same A9 round -- different lanes per HDR20 (Dev-Gov for
  this batch; C-anmälan lane and/or "stäng av nu" one-liners for the rest), not this startbrief.

## 9. Dispatch failure and fix: RED probes cannot write inside the checkout

All four `devgov-v0-orchestrate` runs (ids 36616724494/34693/43793/47314) -- dispatched from the
pushed+dispatched SHAs in the candidate-SHA table above, on Jimmy's explicit "dispatch" -- failed at
`RED / <unit> / Execute declared proof without signer authority`, exit code 3, zero stdout (the
`stdout_sha256` in the log is literally the SHA-256 of an empty string -- the script crashed before
printing anything). GREEN, signing, and the gate itself never ran (skipped as a consequence).

**Root cause**, confirmed directly from `devgov-v0-attest.yml`: the trusted-execution sandbox
freezes the *entire* candidate checkout read-only for the code under test --
`sudo chmod -R a-w candidate` and `sudo chmod -R a-w "$execution_root"`, with write access restored
only for `node_modules`. Every unit's `required_red` command wrote its temp probe test file to
`tests/unit/__<unit>-red-N.probe.test.ts` -- a path inside that now-frozen tree. The write fails
immediately, before any of the command's own error handling can run.

This does not call the underlying security fixes into question -- both RED and GREEN had already
been verified as behaving correctly by running the real commands directly (this session and,
independently, the verifier, twice), against real production code. The break is specific to the
temp-file mechanism RED used to prove the vulnerability, which had only ever been exercised on an
ordinary (non-sandboxed) local checkout.

**Fix**, verified locally against both fixed and reverted code for all four units (identical
pass/fail counts to every prior verification round -- see each unit's own `fix(devgov)` commit
message, listed in the candidate-SHA table above, for its exact numbers):
- RED's temp probe file(s) now live under `os.tmpdir()`, never inside the checkout.
- Every relative `import`/`vi.mock()` specifier in the embedded test source is rewritten to an
  absolute path, resolved against the checkout root *at runtime* (`process.cwd()`, which
  `devgov.mjs`'s `execute-proof` sets to the execution worktree) -- `vi.mock('../../server/x', ...)`
  must resolve to the exact same path as the corresponding `import ... from '../../server/x'` for
  Vitest to apply the mock, so a single whole-file specifier rewrite correctly covers both without
  needing to distinguish import statements from mock calls.
- Vitest is invoked with `--root` pointing at that temp directory, because Vitest's own file
  discovery (and CLI-supplied file arguments) only considers files that are descendants of its
  configured root -- a bare `os.tmpdir()` path is invisible to it regardless of whether it matches
  the `include` glob's shape. The temp root mirrors only what the "unit" project's root-relative
  settings actually need: a copied `tests/setup/env.ts` (`setupFiles: ['tests/setup/env.ts']` is
  root-relative; every `resolve.alias` entry uses `path.resolve(__dirname, ...)` instead, anchored
  to the config file's real location and therefore unaffected by `--root`) and a symlinked
  `node_modules` (bare-specifier imports like `dotenv`/`express`/`vitest` resolve via Node's upward
  `node_modules` search from the importing file, which finds nothing under a bare temp root).

**How this was caught before a second failed dispatch, not after:** rather than re-dispatch
directly, the fix was verified locally first by extracting each unit's exact `required_red`/
`required_green` command from its committed JSON and executing it exactly as the controller would
(`node -e "<body>"`, not a saved script file -- `node -e` defaults to CommonJS regardless of this
repo's `"type": "module"`, but a saved `.js` file does not) -- the same method used for every prior
RED/GREEN verification round in this document.

A second, independent catch during this fix, flagged by Jimmy relaying a line-by-line review before
any of the above was implemented: the initial fix draft rewrote `import` statement specifiers but
would have missed `vi.mock()` call specifiers, which -- per Vitest's own mock-to-import path
matching -- would have caused every embedded test's mocks to silently stop intercepting, running
the real implementation instead without producing a visible error. Confirmed by inspection that
every `vi.mock()` call in this work's test files uses the identical specifier string as its
corresponding `import`, which is exactly why a single non-context-aware rewrite correctly fixes
both at once.

**A second, self-inflicted bug, found immediately after the first fix, before any re-dispatch:**
propagating the `required_red` fix to the other three branches was done by `git checkout
<combined-reference-branch-sha> -- <unit-json-path>`, copying that path's *entire* content from the
non-candidate combined reference branch (`claude/security-hardening-hd04-hd09-v1`, kept only for
local convenience, explicitly not itself a candidate -- see the header table above). That branch's
own copy of each unit JSON had never had its `base_sha` bumped past the original `b48ed5e2`, so the
copy silently reverted each real candidate branch's `base_sha` from the correct `dc78d44c` back to
`b48ed5e2` alongside the intended `required_red` fix. Caught immediately by `devgov-helper.mjs
preflight`, which suddenly reported 60 `FORBIDDEN_PATH`/`NOT_ALLOWED` errors naming files with no
relation to this work (`localizationPdfService.ts`, `sewageRoutes.test.ts`, W3a/W3b/HD-sweep files,
...) -- the tell was that `git diff --name-only <declared-base>..HEAD`, run manually, showed only
the correct 4 files, while the controller's own `evaluateRepositoryState` (invoked by the same
preflight run) showed 64, meaning the two were computing the diff against two different `base_sha`
values. Fixed by setting `base_sha` back to `dc78d44c` directly on each of the four real branches
(not by copying from the reference branch again), verified locally (RED/GREEN, identical pass/fail
counts once more) and via `devgov-helper.mjs preflight` (0 errors on all four) before committing.
**Lesson for next time:** never propagate a fix across sibling candidate branches by copying a
whole file from a non-candidate reference branch -- cherry-pick the specific *content change*
instead (e.g. diff and apply, or re-run the generating script directly on each real branch), so a
stale field on the reference branch can't silently overwrite a correct one on the candidate.

**Not yet done:** this fix (both parts) has not been reviewed by the verifier, not pushed, and not
re-dispatched.
