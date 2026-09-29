# LU-W3D-FUNDING-RISK-UNRESOLVED-LAYERS-V1 -- D3

**Status:** CANDIDATE (implementation complete). RED probe was cold-reviewed on its own first,
confirmed sound and cleared for implementation, before any production code was written -- per the
K-28 ordering (returning to it after W3b's own RED-only-first candidate; not repeating W3a's
disclosed deviation).
**Unit:** `governance/devgov/units/lu-w3d-funding-risk-unresolved-layers-v1.json`
**Base:** `81260bcf2fec45ddeb281fb32ea8680ecad457af` (W3b merged).
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

## 5. Final disposition

RED-only candidate cold-reviewed and cleared for implementation before any production code was
written. Implementation complete: the RED probe still fails on a fresh base, now passes on this
candidate (17/17), zero regressions in adjacent consumer tests (66/66 combined), typecheck clean on
both the root and scoped checks. Awaiting cold review of the implementation itself before freezing
the exact SHA, then the established chain: cold verification -> owner push-go -> PR (branch
`w3d-funding-risk-scoring`, the unit's own `remote.branch`) -> dispatch (owner only) -> attestation
-> merge.
