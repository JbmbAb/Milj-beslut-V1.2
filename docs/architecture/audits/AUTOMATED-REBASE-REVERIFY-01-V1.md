# AUTOMATED-REBASE-REVERIFY-01-V1

**Final state:** UNVERIFIED -- own, separately-unverified implementation candidate of an already
COLD_VERIFIED/ACCEPT design. Not pushed. Not independently cold-reviewed (W1-VERIFY-DB routing has
not run). No CI execution has happened -- every result below is a local, controller-verified dry-run
only.

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
(`C:\wt-automated-rebase-reverify-01` at candidate `0a5a4f1a7e07d772d8fbb3a841aa5dfc324e8720`;
`C:\wt-automated-rebase-reverify-01-base`, detached at `740b2fdfa1faffb19b922d4eaeb187ce492521cf`)
via the **real, unmodified controller** (`node scripts/devgov/devgov.mjs run-red` /
`run-green`), not a hand-rolled test harness:

| id | RED (base_sha) | GREEN (candidate_sha) |
| --- | --- | --- |
| phase1-rejects-pre-existing-base-sha-drift | FAIL (expected FAIL) | PASS |
| phase2-rejects-edit-disguised-as-base-sha-only | FAIL (expected FAIL) | PASS |
| staleness-gate-excludes-conflicting-prs | FAIL (expected FAIL) | PASS |

All 6/6 match their `expected_classification`. `devgov-helper.mjs lint` was re-run after the
`blocked_exit_codes`/`timeout_ms` fix and is clean (0 errors; the remaining DGL-022 warnings on the
RED entries -- "path exists at candidate but not base_sha" -- are the intentional, hint-blessed case:
"ignore only if absence of that artefact IS the property under test", which it is here).

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
