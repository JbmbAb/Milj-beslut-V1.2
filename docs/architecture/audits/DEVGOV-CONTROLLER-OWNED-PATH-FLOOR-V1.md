# DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1

## Summary

This is the Step 5 F-10 rebuild, per the owner's frozen 2026-09-25 decision to stop patching
`DG-IP-001-PROTECTED-CONTROLLER-SEPARATION`'s regex/substring approach and instead remove the
candidate's ability to influence the protected execution mechanism at all -- the same principle
that closed F-11 (`repository_dispatch` instead of validating `workflow_dispatch` caller text).

**Live finding that motivated re-opening this work**: independently re-verified on current `main`
(2026-09-29, well after the two prior "Step 5 PROVEN" and "postproven hardening" merges,
PR #178/#179 and the `f6e241d8` hardening commit) that `DG-IP-001`'s `noDynamicNodeInvocation()`
regex (`/\bnode\s+["'`]*[$`]/`) still does not detect the documented round-3 bypass: a candidate's
proposed edit to `devgov-v0-attest.yml` can satisfy every `hasAll`/`hasNone` substring check while
the real signing invocation is constructed via shell token-splitting and `eval`
(`n=no; d=de; eval "$n$d candidate/scripts/devgov/devgov.mjs attest-execution ..."`), where the
literal 4-character string `node`never appears anywhere in the file. The prior hardening commit
added real value (path-traversal protection, JS`//`comment stripping, tighter gate wiring) but
never changed this specific function. This is confirmed still live on production`main` as of this
unit's base_sha, not a stale or already-fixed finding.

## Design process

An initial design (extract the execute/attest invocations into two new composite actions,
referenced via a fixed `uses:` line, plus a controller-owned floor covering only the two new
action directories) was adversarially red-teamed by three independent reviewers (attacker lens,
GitHub-Actions-platform-semantics lens, path-governance lens) before any code was written. All
three independently found the same blocking defect: the floor did not cover the _calling_ workflow
files (`devgov-v0-attest.yml` etc.), which real, historically-precedented Dev-Gov units are
routinely granted `allowed_paths` access to -- so a candidate could simply edit the `uses:` line or
delete the `environment:` approval-gate key directly, with no eval trickery needed at all,
completely defeating the redesign. Two of the three reviewers independently proposed the same
simpler alternative, adopted here: skip composite actions entirely, fold the calling workflow
files themselves into the floor in full, and require every dynamic value in their `run:` blocks to
flow through `env:` + a quoted shell variable rather than a spliced `${{ }}` expression.

## What changed

- **`scripts/devgov/devgov.mjs`**: adds `CONTROLLER_OWNED_FLOOR_PATHS`, a hardcoded,
  controller-owned constant (not derived from any unit definition) listing paths forbidden for
  _every_ Dev-Gov unit regardless of what that unit's own `allowed_paths`/`forbidden_paths`
  declares:
  - `scripts/devgov/**` (the controller itself)
  - `governance/devgov/schema/**`
  - `governance/devgov/invariant-packs/**` (the pack registry -- a candidate who could edit this
    could disable or weaken any invariant)
  - `.github/workflows/devgov-v0-attest.yml`, `-gate.yml`, `-orchestrate.yml`,
    `devgov-invariant-packs.yml`

  `evaluateRepositoryState`'s single call to `classifyDiffScope` (previously
  `manifest.forbidden_paths` alone) now passes
  `[...(manifest.forbidden_paths || []), ...CONTROLLER_OWNED_FLOOR_PATHS]`. `classifyDiffScope`
  already checks forbidden paths before allowed paths, so this floor cannot be widened, overridden,
  or omitted by any unit definition -- a unit with an _empty_ `forbidden_paths` array is rejected
  exactly the same as one that lists the floor explicitly. This is the only call site of
  `classifyDiffScope` in the file (confirmed by direct grep before implementing, so there is
  nowhere else the floor could have been left unapplied).

- **`scripts/devgov/invariant-packs.mjs`**: adds a new controller-owned invariant,
  `DG-IP-009-CONTROLLER-OWNED-PATH-FLOOR`, as a second, independent defense layer (the existing
  `DG-IP-001`/`DG-IP-002` checks are left in place as a semantic backstop in case the floor itself
  ever has a bug, rather than being deleted now that the floor makes them largely unreachable in
  the intended path). It verifies, against the candidate's own copy of `devgov.mjs`:
  1. `CONTROLLER_OWNED_FLOOR_PATHS` is defined with exactly the expected path set (a missing entry
     fails the check).
  2. The floor is actually unioned into the `classifyDiffScope` call (a regression that silently
     dropped the spread fails the check).
  3. `noTemplateSpliceInRunBlocks()`: no `run: |`/`run: >` block anywhere in
     `devgov-v0-attest.yml` splices a `${{ }}` expression directly into its shell text (YAML
     block-scalar indentation is used to find each `run:` body precisely, so a `${{ }}` legitimately
     used elsewhere in the file -- e.g. in a `with: { name: ... }` field on a `uses:` step, which
     GitHub's own engine resolves and which never touches a shell -- is correctly not flagged; this
     was caught and fixed during this unit's own development, see Verification below).
  - `REQUIRED_V1_INVARIANT_IDS` and `devgov-controller-core-v1.json`'s `invariants` array (bumped
    to `pack_version: 2`) both add `DG-IP-009-CONTROLLER-OWNED-PATH-FLOOR`.

- **`scripts/audit/devgovExactShaVerification.test.ts`**, **`devgovInvariantPacks.test.ts`**:
  narrow, mechanical test-fixture updates made necessary by the floor itself, not logic changes.
  The exact-SHA test's fixture previously used `scripts/devgov/devgov.mjs` as its generic
  "some allowed file changed" placeholder path (with `allowed_paths: ['scripts/devgov/**']`) to
  exercise the _ancestry-policy_ logic under test -- that placeholder is now, correctly, rejected
  by the new floor, so the fixture was moved to a non-floored path
  (`docs/architecture/audits/**` / `PLACEHOLDER.md`) that doesn't collide, without touching the
  ancestry assertions themselves. The invariant-packs test's hardcoded `toHaveLength(9)` was bumped
  to `10` to account for the new invariant.

## Known, accepted consequence

Once merged, **no future Dev-Gov unit can ever modify any floored path again** -- including
`scripts/devgov/devgov.mjs` and `invariant-packs.mjs` themselves. A legitimate future change to any
of these paths (including a future fix to `CONTROLLER_OWNED_FLOOR_PATHS` or a bug fix to the
controller) must land via a direct commit to `main` outside the Dev-Gov unit mechanism, not through
a governed candidate PR. This is intentional and matches the owner's explicit design choice
(confirmed via a structured decision between the composite-action and full-floor alternatives), not
an oversight.

One real, pre-existing artifact is affected: `governance/devgov/units/dev-gov-v7-derived-target-identity.json`
(committed on `main`, `status: null`/never merged) declares `allowed_paths` including
`scripts/devgov/devgov.mjs`, `scripts/devgov/trusted-attestation.mjs`, and
`.github/workflows/devgov-v0-attest.yml` -- exactly the combination this floor is designed to make
impossible. Its `base_sha` (`128909dd...`) is from a much earlier `dev-gov-v6`/`v7` round and it
uses `ancestry_policy: exact_parent` against a parent many hundreds of commits behind current `main`
-- independently checked and found to be stale/abandoned (no active branch work, no recent commits,
no cross-session reference to it as in-flight), not a live conflict. This unit does not delete or
modify that file (out of this unit's `allowed_paths`); it is left as an inert artifact that the new
floor would now correctly reject if anyone ever tried to dispatch against it, which is the intended
behavior, not a bug.

## Verification

- Real-controller local proof: the probe script (below) directly exercises
  `evaluateRepositoryState` with a synthetic unit definition whose own `forbidden_paths` is
  _empty_ and whose `allowed_paths` includes a floored file -- proving the floor's protection does
  not depend on what any unit declares about itself. Run against base (no floor): incorrectly
  admits the touch (violation, matches RED's `expected_classification: FAIL`). Run against
  candidate (floor present): correctly denies it with a `FORBIDDEN_PATH` error (matches GREEN's
  `expected_classification: PASS`).
- Four manual negative controls (beyond the two required RED/GREEN checks), each confirmed to
  fail for the right stated reason then restored: (1) a legitimate unit touching an unrelated file
  still passes; (2) removing one entry from `CONTROLLER_OWNED_FLOOR_PATHS` makes `DG-IP-009` fail
  with a "missing" detail naming exactly that entry; (3) reverting the `classifyDiffScope`
  call-site union makes `DG-IP-009` fail citing the missing spread; (4) injecting a direct
  `${{ inputs.x }}` splice into a `run:` block in `devgov-v0-attest.yml` makes `DG-IP-009` fail,
  citing the exact offending line -- and a genuine false positive was caught and fixed during this
  process: the first version of the splice-detector flagged `${{ inputs.x }}` occurrences inside
  `with: { name: ... }` fields on `uses:` steps (safe, resolved by GitHub's engine, never touches a
  shell) before being rewritten to scope strictly to `run:` block bodies via YAML block-scalar
  indentation.
- Full `evaluateInvariantPacks()` run against the candidate: `result: PASS`, all 9 named
  invariants plus the `DG-IP-000` canonical-set-completeness synthetic check pass.
- Real `scripts/audit/devgov*.test.ts` suite (144 tests, 12 files): 140 pass. The remaining 4
  failures are all `Test timed out in 5000ms` on tests that spawn real `git`/subprocess operations
  in temp directories -- independently confirmed to be pre-existing, non-deterministic flakiness on
  this specific (slow, Windows) development machine, not caused by this unit: an unmodified-`main`
  baseline run of the same test files also produced 4 timeout failures (different specific tests
  each run), and re-running the failing tests in isolation with a longer timeout passes them
  cleanly. No assertion failure was observed in any run.

## Non-claims

This unit does **not**:

- rewrite `DG-IP-001`/`DG-IP-002`'s existing substring-based logic -- both are left as a semantic
  backstop layer, independent of the new structural floor;
- touch any workflow file's content -- the floor protects them by path, not by editing them;
- resolve or clean up `dev-gov-v7-derived-target-identity.json` (flagged above, left as an inert,
  now-correctly-unreachable artifact);
- change application code, data, secrets, or any other Dev-Gov schema file;
- claim F-01 through F-14 (Step 5's own earlier falsification battery) have been rerun in full
  after this merge -- only F-10 is in scope here.

## Risk assessment

- Data/security impact: closes a live, independently-reconfirmed structural gap in the Dev-Gov
  trust chain (a candidate legitimately allowed to touch protected workflow files could, in
  principle, construct an obfuscated redirection of the signing/execution command that the existing
  text-pattern checks cannot soundly detect). The fix removes the candidate's ability to have that
  diff admitted at all, rather than attempting to validate it.
- Backward compatibility impact: permanently forecloses the Dev-Gov path for modifying the floored
  files (see Known, accepted consequence above) -- an explicit, owner-chosen tradeoff, not an
  unintended regression.
- Rollback plan: revert this unit's merge commit. The floor and the new invariant disappear
  together; `DG-IP-001`/`DG-IP-002` continue functioning exactly as before this unit (unchanged by
  it).
