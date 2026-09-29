# SECURITY-HARDENING-HD04-HD09-V1 -- HD-04..HD-09 findings from A9

**Status:** four candidates COLD_VERIFIED by the independent verifier (K-159, no remarks) and
pushed to origin on Jimmy's explicit go ("push all four"). Pushed branches were then rebased once
more (main advanced significantly while cold review + push were in flight) and are being
re-verified and re-sent for a second cold review before the next dispatch-go. **Not yet dispatched
into the Dev-Gov gate/attestation pipeline.**
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

**Candidate SHAs, current (post-rebase, second round):**

| Unit | Branch | Candidate SHA | First-round SHA (COLD_VERIFIED K-159, pushed) |
|---|---|---|---|
| A (HD-04a/HD-04b/HD-05) | `claude/security-hardening-hd04-05-v1` | `28a35880db799d87f4daec3b6f4d31a1e2957738` | `1911598925613370d42a2ace506eb0add08829d8` |
| B (HD-06) | `claude/security-hardening-hd06-v1` | `ab5489fee2d5a728eeced5e9353584c2e5ee8443` | `3615e94ca6e5ff8546897fa22facac1a6f576354` |
| C (HD-07/HD-08) | `claude/security-hardening-hd07-08-v1` | `d0b8acb8322744ee0103a4922eab73400fc66d2f` | `c696e562f31504ecb4d397fbe6b8a4da6463c68e` |
| D (HD-09) | `claude/security-hardening-hd09-v1` | `df2385223b3f6f12d74d5e68db8de8114f8d39c6` | `0c7817a5e031446d6400767ef312414d5c6fd27f` |

Each current SHA is a merge commit (`origin/main` at `dc78d44c` merged in, no force, no conflicts)
plus one `base_sha`-bump commit on top of the first-round SHA already pushed and cold-reviewed --
no production-code or test-content changes in this round, only the base pointer. The rebase and
re-verification were authorized in-session by Jimmy ("fortsätt godkänner") after a separate,
unverified cross-session message claiming the same authorization under the display name "Boss"
was identified and explicitly refused -- see the security-hardening session's own transcript for
that exchange; not repeated here since it is process history, not part of this unit's code.

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
