# LU-W3D-FUNDING-RISK-UNRESOLVED-LAYERS-V1 -- D3

**Status:** CANDIDATE (implementation complete). RED probe was cold-reviewed on its own first,
confirmed sound and cleared for implementation, before any production code was written -- per the
K-28 ordering (returning to it after W3b's own RED-only-first candidate; not repeating W3a's
disclosed deviation).
**Unit:** `governance/devgov/units/lu-w3d-funding-risk-unresolved-layers-v1.json`
**Base:** `dc78d44cd47c9a9cc46ffc805a53751861221765` (bumped twice; see §5a and §5b for why and how
each was re-verified).
**Design authority:** `W3-DESIGN-DECISION-2026-09-28.writer-copy.md` §1 Group D, D3 -- last of the
four named W3 units (W3c/W3a/W3b already merged). Full scope note, including every fact re-verified
against current main and a finding the original design doc did not name (nothing currently
populates `mapLayerSelection.unavailable` with real content, so this unit's live exposure today is
narrower than D1/D2/C1/C2 were), cold-reviewed and confirmed with no corrections:
`Claude outputs/w3d-design-2026-09-29/W3D-SCOPE-NOTE-2026-09-29.md`.

## 0. Scope decisions confirmed by cold review (not reopened here)

- **Q-W3d-1:** additive-only fix. Surface which tracked map layers are unavailable; do **not**
  change `envScore`/`fundingScore`/`fundingRisk.rating`/`eligibleForGreenLoan`'s existing formulas.
  Building an actual producer for `mapLayerSelection.unavailable` (nothing currently populates it)
  is explicitly out of scope -- confirmed real scope creep into map-layer-availability detection
  this unit did not investigate.
- **Q-W3d-2:** the new field lists raw `MapLayerKey` values (`'GROUNDWATER'`, `'NATURA2000'`,
  `'FLOOD_RISK'`), matching `environmentalRisk`'s own existing raw-value style, not pre-formatted
  Swedish text.
- **Q-W3d-3:** no new `confidence` field on `environmentalRisk` -- `regulatoryRisk.confidence` is
  itself a pre-existing hardcoded constant (`0.85`, unrelated to any real computed signal); adding
  an analog here would be inventing a new metric next to an already-flagged, separately out-of-scope
  issue.
- **Independently confirmed during cold review, strengthening (not contradicting) the scope note's
  own finding:** `services/projectStructure.ts:611-627`'s `normalizeMapLayerSelection()` passes an
  arbitrary caller-supplied `unavailable` value through unfiltered (unlike `base`/`optional`/`enabled`,
  which fall back to template defaults when empty) -- the same ingestion path the scope note's
  "generic plan-save endpoint accepts arbitrary `Partial<ProjectPlan>`" point already covers, now
  named exactly. Confirms this unit's "currently-unreachable-in-practice input, not an observed live
  bug" framing holds even accounting for this specific function.

## 1. RED probe (this candidate's only content)

`tests/unit/predictiveScoringService.test.ts` (modified, +3 tests), all in a new describe block:
- names every one of three unavailable layers (`GROUNDWATER`, `NATURA2000`, `FLOOD_RISK`) in
  `environmentalRisk.unresolvedLayers` when all three are unavailable.
- names only the one specific unavailable layer (`NATURA2000`) when the other two are `enabled`
  instead -- proves the field reflects the actual unavailable set, not a blanket "something is
  wrong" flag.
- reports an empty `unresolvedLayers` array (not `undefined`, not omitted) when nothing is
  unavailable -- the clean baseline.

## 2. What changed (implementation, after the RED-only candidate was cleared for it)

`services/predictiveScoringService.ts`'s `calculatePredictiveScores()` gains one new computed
value: `unresolvedLayers` filters the three tracked `MapLayerKey`s (`'GROUNDWATER'`, `'NATURA2000'`,
`'FLOOD_RISK'`) against `plan.mapLayerSelection.unavailable`, and the result is added to the
returned `environmentalRisk` object alongside its existing `score`/`groundwaterImpact`/
`biodiversityImpact`/`floodingImpact` fields. `envScore`, `fundingScore`,
`fundingRisk.rating`/`eligibleForGreenLoan` are all untouched -- exactly the additive-only scope
Q-W3d-1 confirmed.

## 3. Verified evidence

**RED**, re-confirmed against a fresh, separate worktree pinned to `81260bcf`
(`C:\wt-w3d-base2`, junctioned `node_modules`, K-29 pattern) after cold review cleared the RED-only
candidate for implementation: the probe still fails for the same three reasons as §1, unchanged.

**GREEN**, run via the exact embedded command against this candidate: exits 0, 17/17 tests (the 3
new plus the 14 pre-existing). Includes the K-118-style byte-identity self-check, built in from the
start -- verified it actually fires by deliberately appending a comment to
`predictiveScoringService.test.ts`, confirming the GREEN proof then failed with exit 2 and the
expected `W3D_HARNESS_ERROR ... does not byte-match ...` message, then restoring the file and
reconfirming exit 0 (17/17).

**Consumer regression check:** three files read `environmentalRisk`'s fields --
`components/admin/ProjectScoringDashboard.tsx`, `components/ExecutiveSummary.tsx`,
`server/services/projectPlanService.ts` -- all read only the pre-existing fields, none reference
`unresolvedLayers`, confirmed by direct grep of each call site. Their own test files
(`tests/components/executiveSummary.test.tsx`, `tests/unit/executiveSummary.test.ts`,
`tests/unit/ExecutiveSummary.test.tsx`, `tests/unit/projectPlanService.test.ts`,
`tests/unit/projectPlanServiceExtended.test.ts`) all still pass unmodified: 66/66 total combined
with the target file's own 17.

**Typecheck:** `predictiveScoringService.ts` is one of `tsconfig.json`'s own explicitly-excluded
files (alongside `orchestrationService.ts`/`projectStructure.ts`), and its consumer
`server/services/projectPlanService.ts` sits under the wholesale-excluded `server/**`, so two checks
were run. Root `tsc --noEmit`: **87 errors on both base and candidate**, byte-identical sorted error
sets (diffed, not just counted). Scoped, explicit-file-list `tsc` covering the changed file plus all
three consumers (same `compilerOptions` as `tsconfig.json`): **0 errors on both sides** -- confirms
the additive field caused no assignment-compatibility issue at `projectPlanService.ts:62`'s
`predictiveScores: calculatePredictiveScores(...)` site. This holds despite `src/types/project.ts`'s
own inline `environmentalRisk: { score, groundwaterImpact, biodiversityImpact, floodingImpact }`
type (line 186) not being updated to list `unresolvedLayers` -- confirmed deliberately, not
overlooked: the assignment happens through a function-call result, not an object literal in a typed
position, so TypeScript's excess-property check does not apply and the wider actual shape is simply
assignable to the narrower declared one. `src/types/project.ts` is outside this unit's
`allowed_paths`, and no error appeared to justify touching it.

## 4. Non-claims -- what this unit does not do

Does not change the funding-score formula, `fundingRisk.rating` thresholds, or
`eligibleForGreenLoan`'s condition (Q-W3d-1). Does not build a producer for
`mapLayerSelection.unavailable` -- that field's absence-of-a-writer is a separate, larger finding,
noted but not fixed. Does not touch `regulatoryRisk.confidence` (Q-W3d-3, pre-existing, unrelated)
or `.cursor/rules/import-focus-product.mdc` (Q6, still unaddressed from the original design round).
Does not update `src/types/project.ts`'s inline type -- confirmed unnecessary, not overlooked (§3).
This is the last named W3 unit from the original design round; no further W-unit is currently
scoped beyond this one.

## 5a. Forced base bump: `81260bcf` -> `ea1ced0e`, after PR #201's own merge and dispatch

The candidate (`64316c65`) was cold-reviewed, cold-verified, pushed, PR #201 opened, dispatched
(full trusted-execution success), and Jimmy issued `merge` -- but GitHub refused the merge:
`the head branch is not up to date with the base branch`. Main had advanced by one commit,
`ea1ced0e4eaa112e2913a6aaf7e4966253550a9e` ("collapse signing to one same-run click,
V1-THROUGHPUT"), a **direct commit to main outside the governed unit mechanism** -- per its own
audit doc (`docs/architecture/audits/DEVGOV-V1-THROUGHPUT-SAME-RUN-SIGNING-V1.md`), every file it
touches sits inside `CONTROLLER_OWNED_FLOOR_PATHS` (DEVGOV-CONTROLLER-OWNED-PATH-FLOOR-V1), which by
that unit's own design can never be touched through the governed RED/GREEN/gate mechanism -- only a
direct owner commit, cold-reviewed by an independent peer session first (confirmed: that document
records exactly this review, verdict `SOUND_WITH_CHANGES`, one finding fixed and re-verified).

**Why this bump needed more scrutiny than an ordinary one:** unlike prior same-day bumps in this
program (W3a's `f14e832e`->`b48ed5e2`->`12e63380`, all docs-only), this commit restructures the
*actual signing/dispatch mechanics* `devgov-v0-attest.yml` and `devgov-v0-orchestrate.yml` --
moving the per-proof `attest:` signing job out entirely into one same-run `sign:` job in the
orchestrator. Confirmed via the commit's own diff (`git diff 81260bcf ea1ced0e --stat`): zero
overlap with this unit's own `allowed_paths` (`services/predictiveScoringService.ts`, its test, this
doc, this unit's own JSON). Merged clean (`git merge origin/main --no-edit`, no conflicts). Re-ran
the RED probe against a freshly isolated `ea1ced0e` worktree (still fails, same reason); re-ran
GREEN via the exact embedded command against the merged candidate (still passes, 17/17). **Also ran
the real `invariant-packs.mjs` CLI locally** (controller = the fresh `ea1ced0e` worktree, candidate
= this merged tree, same command the orchestrator runs) before requesting a fresh dispatch-go --
all 9 invariants PASS, including `DG-IP-002-SIGNER-ISOLATION` (the invariant most plausibly affected
by a signing-mechanism restructure). This is the same discipline applied to the F-10/`DG-IP-009`
dispatch failure during W3a: confirm the fix genuinely resolves the blocker locally before asking
for a real dispatch run, rather than assuming a clean merge is sufficient.

**Note added after §5a's own dispatch:** the bumped candidate (`5cdcb436`) was cold-reviewed a
second time (independent RED/GREEN re-run and an independent `invariant-packs.mjs` run, both from
scratch), dispatched, and the trusted-execution pipeline passed in full -- including confirming the
new same-run `Sign trusted execution attestations` job (V1-THROUGHPUT's own change) replaced the
prior two separate per-proof signing jobs, exactly as designed. This was the first real dispatch to
exercise the new signing architecture for any unit in this program.

## 5b. Second forced base bump: `ea1ced0e` -> `dc78d44c`, after Jimmy's `merge` on the already-dispatched candidate

Jimmy issued `merge` on `5cdcb436` (already fully proven via the dispatch above) -- GitHub again
refused: main had advanced by one more commit, `dc78d44cd47c9a9cc46ffc805a53751861221765`, PR #196
("HD-sweep: A9 security/correctness findings HD-01/02/03/10/14/15/16"), a **different** session's
governed unit (`hd-sweep-a9-01-v1`, its own `docs/architecture/audits/HD-SWEEP-A9-01-V1.md` and
`governance/devgov/units/hd-sweep-a9-01-v1.json`). Confirmed via `git diff ea1ced0e dc78d44c --stat`:
17 files, all under `server/{routes,security,services,modules}/**` and their tests, plus that unit's
own two governance files -- zero overlap with this unit's own `allowed_paths`.

**Worth recording, not acting on:** one of the 17 files, `server/services/bankComplianceService.ts`
(and its test), is the exact same file W3b's C1 finding identified and left untouched as
forward-only dead code (only the *route* calling it, `bankCompliance.routes.ts`, was deleted in
W3b). PR #196's own HD-01 finding independently discovered the identical root bug
(`evaluateComplianceRules([], [], {} as any, [])`, permanently-empty inputs) and fixed the function
itself -- it now throws a `SecureError` instead of returning a fabricated report. Two independent
sessions converged on the same root cause via two different, non-conflicting remediation
strategies (retire the entry point vs. fail the function closed); no actual file conflict, since
W3b never modified `bankComplianceService.ts`'s own content. Not this unit's concern to reconcile
further -- noted here only so a future reader isn't surprised to see that file's history touched by
two separate W-track/HD-track units.

Merged clean (`git merge origin/main --no-edit`, no conflicts). Re-ran the RED probe against a
freshly isolated `dc78d44c` worktree (still fails, same reason); re-ran GREEN via the exact embedded
command against the merged candidate (still passes, 17/17). Re-ran the real `invariant-packs.mjs`
CLI locally (controller = the fresh `dc78d44c` worktree, candidate = this merged tree): all 9
invariants PASS, including `DG-IP-002-SIGNER-ISOLATION` again, since the signing architecture from
§5a is still what this base carries forward.

## 6. Final disposition

RED-only candidate cold-reviewed and cleared for implementation before any production code was
written. Implementation complete: the RED probe still fails on a fresh base, now passes on this
candidate (17/17), zero regressions in adjacent consumer tests (66/66 combined), typecheck clean on
both the root and scoped checks. Two independent cold reviews (RED-design, then implementation), no
outstanding findings. Full trusted-execution pipeline passed once already on `64316c65` (proving out
the new V1-THROUGHPUT signing architecture for the first time in this program) and again on
`5cdcb436`; two same-day direct-to-main/independent-PR commits (`ea1ced0e` §5a, `dc78d44c` §5b) each
forced a base bump before the already-approved merge could complete -- both re-verified locally
(RED/GREEN/invariant-packs all clean) before requesting the next dispatch-go.
